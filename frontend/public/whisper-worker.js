// VeilNote — 온디바이스 Whisper 워커 (WebWorker, 별도 스레드)
//
// 오디오(16kHz mono Float32Array)를 받아 브라우저 안에서 텍스트로 변환한다.
// 서버로 오디오를 전송하지 않는다 — "오디오는 기기를 벗어나지 않는다"가 아키텍처 사실.
//
// UI 스레드를 막지 않도록 무거운 추론은 전부 이 워커에서 실행된다.
// WebGPU 가속을 우선 시도하고, 불가하면 WASM으로 자동 폴백한다.

import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

// 원격 모델만 사용(로컬 파일시스템 조회 비활성). 최초 1회 CDN에서 받아 브라우저 캐시에 저장됨.
env.allowLocalModels = false;

// 다국어 base 모델 — 한국어 인식률을 위해 tiny보다 base 이상을 사용.
// (양자화 가중치라 브라우저 캐시에 한 번 받아두면 오프라인에서도 동작)
const MODEL_ID = 'Xenova/whisper-base';

let transcriber = null;
let activeDevice = null;

/**
 * Whisper의 잘 알려진 반복 루프(repetition loop) 안전장치.
 * 같은 단어(또는 최대 3단어 구절)가 maxRepeat번을 넘게 연속으로 반복되면
 * 그 이후 반복분은 잘라낸다. 디코딩 옵션(no_repeat_ngram_size 등)으로 못 막은
 * 경우를 대비한 마지막 방어선.
 * @param {string} text
 * @param {number} maxRepeat
 */
function collapseRepeats(text, maxRepeat = 3) {
  if (!text) return text;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;

  const sameBlock = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const out = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const block = words.slice(i, i + n);
      let repeats = 1;
      let j = i + n;
      while (j + n <= words.length && sameBlock(words.slice(j, j + n), block)) {
        repeats++;
        j += n;
      }
      if (repeats > maxRepeat) {
        for (let k = 0; k < maxRepeat; k++) out.push(...block);
        i = j;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      out.push(words[i]);
      i++;
    }
  }
  return out.join(' ');
}

// Whisper 환각(hallucination) 안전장치: 무음/저품질 구간에서 학습 데이터에 있던 뉴스
// 클로징 멘트나 유튜브 아웃트로 같은 문구를 실제로 들은 것처럼 만들어내는 경우가 있다.
// transformers.js(v3.0.2 기준) Whisper 파이프라인에는 원본 OpenAI whisper의
// no_speech_threshold/logprob_threshold 같은 "이 구간에 음성이 있을 확률이 낮으면 버린다"는
// 옵션이 아직 포팅되어 있지 않아(WhisperGenerationConfig에 존재하지 않음) 디코딩 단계에서
// 막을 방법이 없다. 대신 자주 나오는 환각 문구 패턴을 결과 텍스트 전체에 대해 검사해서,
// 매치되면 그 구간 결과를 통째로 버린다(부분적으로 잘라내지 않음 — 환각은 보통 문장 전체가
// 통째로 지어내진 것이라 일부만 남기면 오히려 더 이상해진다).
const HALLUCINATION_PATTERNS = [
  /(MBC|KBS|SBS|YTN|JTBC)\s*뉴스/i,
  /뉴스\s*[가-힣]{2,4}(입니다|였습니다)/,
  /구독\s*과\s*좋아요/,
  /좋아요\s*와\s*구독/,
  /구독\s*,?\s*좋아요\s*,?\s*알림\s*설정/,
  /채널\s*구독/,
  /알림\s*설정/,
  /시청해\s*주셔서\s*감사합니다/,
  /끝까지\s*시청해\s*주셔서/,
  /다음\s*영상에서\s*(만나요|뵙겠습니다)/,
  /영상\s*편집/,
  /자막\s*제공/,
];

/**
 * @param {string} text
 * @returns {boolean} 환각으로 보이는 문구면 true
 */
function isLikelyHallucination(text) {
  if (!text) return false;
  return HALLUCINATION_PATTERNS.some((re) => re.test(text));
}

// [...] 형태의 대괄호 텍스트("[몇 번째]", "[두 번째 공격]" 등)도 잘 알려진 환각 패턴이라
// 통째로 제거한다. (참고: 민감정보 토큰화는 이 워커 이후 단계에서 별도로 이루어지고
// [ORG_1] 같은 실제 토큰은 여기 들어오는 원문 음성인식 결과에는 나타나지 않는다.)
function stripBracketedText(text) {
  if (!text) return text;
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 위 HALLUCINATION_PATTERNS보다 더 단순하고 넓게 잡는 키워드 목록. 완벽하게 정확하진
// 않아도(정상 문장을 오탐할 수 있음을 감수하고) 문장 단위로 걸러 환각을 최대한 줄인다.
const HALLUCINATION_KEYWORDS = ['뉴스', '구독', '좋아요', '시청해주셔서', '시청해 주셔서'];

/**
 * 마침표/물음표/느낌표/줄바꿈 기준으로 대략적인 문장 단위로 나눈다. 한국어 음성인식
 * 결과엔 문장부호가 없는 경우도 많아 완벽하지 않지만, 안전장치 용도로는 충분하다.
 * @param {string} text
 */
function splitSentences(text) {
  return text
    .split(/[.!?。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} text
 */
function removeHallucinatedSentences(text) {
  if (!text) return text;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text;
  const kept = sentences.filter(
    (s) => !HALLUCINATION_KEYWORDS.some((kw) => s.includes(kw)),
  );
  return kept.join(' ');
}

/**
 * ASR 파이프라인을 (한 번만) 생성한다. WebGPU → WASM 순으로 폴백.
 * @param {boolean} preferWebGPU
 */
async function getTranscriber(preferWebGPU) {
  if (transcriber) return transcriber;

  const attempts = [];
  if (preferWebGPU) attempts.push({ device: 'webgpu', dtype: 'fp32' });
  attempts.push({ device: 'wasm', dtype: 'q8' }); // 양자화로 다운로드/메모리 절감

  let lastErr = null;
  for (const opt of attempts) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device: opt.device,
        dtype: opt.dtype,
        progress_callback: (p) => self.postMessage({ type: 'progress', data: p }),
      });
      activeDevice = opt.device;
      return transcriber;
    } catch (err) {
      lastErr = err;
      // WebGPU 미지원/실패 시 다음 후보(WASM)로 폴백
      self.postMessage({
        type: 'device-fallback',
        from: opt.device,
        error: String(err && err.message ? err.message : err),
      });
    }
  }
  throw lastErr || new Error('ASR 파이프라인 생성 실패');
}

self.onmessage = async (e) => {
  const msg = e.data || {};

  if (msg.type === 'load') {
    try {
      await getTranscriber(msg.webgpu !== false);
      self.postMessage({ type: 'ready', model: MODEL_ID, device: activeDevice });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    const { id, audio, language } = msg;
    try {
      const t = await getTranscriber(msg.webgpu !== false);
      const out = await t(audio, {
        language: language || 'korean',
        task: 'transcribe',
        chunk_length_s: 30, // 긴 오디오 자동 분할
        stride_length_s: 5,
        return_timestamps: false,
        // Whisper의 잘 알려진 반복 루프(같은 단어/구절을 계속 뱉는 버그) 억제.
        no_repeat_ngram_size: 3, // 같은 3단어 조합이 다시 나오는 걸 디코딩 단계에서 차단
        repetition_penalty: 1.3, // 이미 나온 토큰의 재선택 확률을 낮춤
      });
      const rawText = (out && typeof out.text === 'string' ? out.text : '').trim();
      // 디코딩 옵션으로도 못 막은 경우를 대비한 후처리 안전장치들을 순서대로 적용한다.
      const collapsed = collapseRepeats(rawText, 3);
      const noBrackets = stripBracketedText(collapsed);
      const sentenceFiltered = removeHallucinatedSentences(noBrackets);
      const text = isLikelyHallucination(sentenceFiltered) ? '' : sentenceFiltered;
      self.postMessage({ type: 'result', id, text, device: activeDevice });
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        error: String(err && err.message ? err.message : err),
      });
    }
    return;
  }
};
