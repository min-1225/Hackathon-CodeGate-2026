# hackathon_2026
## Frontend
React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

---

온디바이스 Whisper 음성인식 트러블슈팅

VeilNote는 회의 메모에 담긴 회사명, 고객사명, 금액, 인명 같은 민감정보가 브라우저 밖으로 나가지 않아야 한다는 원칙을 서비스의 전제로 삼고 있다. 그래서 음성 입력도 구글 같은 외부 STT API로 오디오를 보내는 대신, Whisper 모델을 브라우저 안에서 WebGPU나 WebAssembly로 직접 돌리는 온디바이스 방식으로 구현했다. 서버로 아무것도 안 보낸다는 장점은 명확했지만, 그만큼 서버 기반 STT였다면 겪지 않았을 문제들을 하나씩 만났다. 아래는 그 과정을 실제 코드와 함께 정리한 기록이다.

1. 모델 로딩 실패 (q4 양자화 에러)

온디바이스 Whisper를 처음 붙였을 때 모델 로딩 단계에서부터 막혔다. `Can't create a session... TransposeDQWeightsForMatMulNBits Missing required scale`라는 에러가 뜨면서 파이프라인 생성 자체가 실패했다. q4 양자화는 모델 가중치를 4비트로 압축해서 용량과 연산량을 줄이는 방식인데, 압축된 값을 다시 원래 스케일로 풀어내려면 scale이라는 별도 메타데이터가 같이 있어야 한다. 에러 메시지 그대로, 로드한 모델 파일에는 그 scale 정보가 빠져 있었고 ONNX 런타임의 MatMulNBits 연산이 역양자화를 못 해서 세션 생성 자체가 실패한 것이었다.

원인을 뜯어보니 당시 코드는 `dtype`을 따로 지정하지 않고 파이프라인을 만들고 있었다. 그러다 보니 모델 저장소에 있는 서브모델(인코더, 디코더)별 기본 양자화 설정을 그대로 따라가게 됐고, 그 과정에서 scale이 없는 q4 변형이 선택된 것이었다. 해결은 간단했다. `dtype`을 q4 대신 fp32로 명시적으로 고정하면 됐다. fp32는 압축 없는 원본 정밀도라 scale 메타데이터 자체가 필요 없으니 이 문제가 아예 발생할 여지가 없다.

```js
// 이전 (초기 온디바이스 Whisper 통합 코드)
loadingPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
  device: "wasm",
  progress_callback: (info) => { /* ... */ },
});

// 이후
loadingPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
  device: "wasm",
  dtype: "fp32", // dtype을 안 정해두면 서브모델별 기본 양자화(q4 등)를 따라가다 이 에러가 다시 날 수 있다
  progress_callback: (info) => { /* ... */ },
});
```

이후 이 구현은 팀원이 검증해준 `public/mic.js`와 `public/whisper-worker.js` 조합으로 완전히 갈아엎었는데, 이 코드는 처음부터 디바이스별로 `dtype`을 항상 명시해두고 있어서 같은 문제가 재현되지 않는다.

```js
// public/whisper-worker.js
const attempts = [];
if (preferWebGPU) attempts.push({ device: 'webgpu', dtype: 'fp32' });
attempts.push({ device: 'wasm', dtype: 'q8' }); // 양자화로 다운로드/메모리 절감
```

2. 음성 인식 속도 지연 및 트레이드오프 시행착오

말을 마치고 나서 텍스트가 화면에 채워지기까지 체감 지연이 컸다. Whisper는 모델 크기가 tiny에서 large로 커질수록 파라미터 수가 늘어 추론 한 번에 드는 연산량이 커지고, 오디오를 얼마나 큰 단위로 묶어 모델에 넣는지도 지연에 직결된다. 한 번에 넘기는 오디오가 길수록 그 구간이 끝나야 결과를 받을 수 있기 때문이다.

그래서 이 두 축을 같이 건드려봤다. 모델을 `Xenova/whisper-base`에서 더 가벼운 `Xenova/whisper-tiny`로 낮추고, `mic.js`의 무음 감지 로직에 말이 안 끊겨도 2.5초마다 강제로 구간을 끊어 보내는 상한(`maxSegmentMs`)을 추가해서 더 짧고 잦은 단위로 결과가 나오게 만들었다. 지연을 줄이기 위한 첫 번째 가설로는 합리적인 시도였다. 하지만 막상 적용해보니 한국어 인식 정확도가 눈에 띄게 떨어졌고, 심지어 체감 속도도 딱히 나아지지 않았다. 이 조합에서는 모델을 줄이고 청크를 짧게 자르는 최적화가 기대한 효과로 이어지지 않았다는 뜻이다.

그래서 모델은 다시 `Xenova/whisper-base`로, 청크 분할도 원래의 무음 감지 기반 `segmentSilenceMs`(900ms) 방식으로 되돌렸다. 데모 환경에서는 반응 속도보다 결과가 실제로 믿을 수 있는 텍스트인지가 더 중요하다고 판단했고, 이번 시행착오를 통해 적어도 지금 이 조합에서는 그 트레이드오프가 성립하지 않는다는 걸 확인했기 때문에 내린 결정이다.

3. 반복 루프(repetition loop) 현상

"어디 어디 어디 어디..."처럼 같은 단어가 무한히 반복되어 나오는 현상이 있었다. Whisper류 STT 모델에서 잘 알려진 디코딩 버그로, 무음이나 침묵 구간, 혹은 청크 경계에서 문맥이 잘린 오디오가 들어가면 모델이 다음 토큰을 예측할 근거가 부족해진다. 이때 repetition penalty 같은 억제 장치가 없으면 직전에 이미 생성한 토큰을 그대로 다시 뽑는 쪽으로 확률이 쏠려버려서 같은 단어나 구절을 계속 반복 생성하게 된다. repetition penalty는 이미 나온 토큰이 다시 선택될 확률을 인위적으로 낮춰서 이 악순환을 끊어주는 역할을 한다.

이 문제는 세 가지를 같이 적용해서 막았다. 먼저 Whisper 디코딩 옵션에 `no_repeat_ngram_size`와 `repetition_penalty`를 추가해서 같은 n-gram이 다시 나오는 걸 디코딩 단계에서부터 억제했다. 무음 구간 감지(VAD) 로직은 `mic.js`에 이미 있었지만, 문맥이 부족해 반복 루프를 유발하기 쉬운 지나치게 짧은 조각(0.35초)이 그대로 모델에 들어가고 있었던 게 문제라 최소 세그먼트 길이를 늘렸다. 마지막으로 디코딩 옵션만으로 못 막는 경우를 대비해서, 결과 텍스트에서 같은 단어나 최대 3단어짜리 구절이 일정 횟수 넘게 반복되면 그 이후를 잘라내는 후처리 필터를 하나 더 얹었다.

```js
// public/whisper-worker.js — 디코딩 옵션으로 반복 억제
const out = await t(audio, {
  language: language || 'korean',
  task: 'transcribe',
  no_repeat_ngram_size: 3, // 같은 3단어 조합이 다시 나오는 걸 디코딩 단계에서 차단
  repetition_penalty: 1.3, // 이미 나온 토큰의 재선택 확률을 낮춤
});
```

```js
// public/mic.js — 무음 감지(VAD)로 너무 짧은 조각 자체를 필터링
this.silenceRms = opts.silenceRms ?? 0.01; // 이 값 이하이면 무음으로 간주
this.minSegmentSec = 0.6; // 0.35초처럼 너무 짧은 조각은 문맥 부족으로 반복 루프를 유발하기 쉬워 늘렸다
```

```js
// public/whisper-worker.js — 반복 텍스트 후처리 필터
function collapseRepeats(text, maxRepeat = 3) {
  const words = text.split(/\s+/).filter(Boolean);
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
    if (!collapsed) { out.push(words[i]); i++; }
  }
  return out.join(' ');
}
```

4. 환각(hallucination) 현상

"MBC 뉴스 김정진입니다"처럼 실제로 아무도 말하지 않은 문장이 인식 결과에 그대로 튀어나오는 현상도 있었다. Whisper는 유튜브 자막이나 방송 콘텐츠를 포함한 방대한 오디오-텍스트 쌍으로 학습됐기 때문에, 무음에 가깝거나 오디오 품질이 낮은 구간이 들어오면 실제로 들은 소리 대신 학습 데이터에 자주 나왔던 뉴스 클로징 멘트나 유튜브 아웃트로 같은 문구를 그럴듯하게 지어내는 경향이 있다. 원래 OpenAI Whisper 구현에는 이걸 줄이기 위한 `no_speech_threshold`(이 구간에 음성이 있을 확률이 낮으면 결과를 버림)와 `logprob_threshold`(생성된 토큰들의 평균 로그확률이 낮으면, 즉 모델 스스로도 확신이 낮으면 결과를 버림) 옵션이 있어서 처음엔 이걸 적용하려고 했다.

그런데 실제로 적용하려고 코드를 뜯어보니 지금 쓰고 있는 `@huggingface/transformers@3.0.2`(whisper-worker.js가 CDN에서 불러오는 버전)에는 이 두 옵션이 아예 없었다. `WhisperGenerationConfig` 소스를 직접 설치해서 확인해봤는데 해당 필드 자체가 존재하지 않았다. 두 옵션 모두 OpenAI의 원본 Python Whisper 구현에만 있는 롱폼 디코딩 휴리스틱이고, 아직 transformers.js에는 포팅이 안 되어 있는 것이었다. 그래서 디코딩 단계에서 임계값으로 걸러내는 방법은 지금 라이브러리 버전에서는 쓸 수 없었고, 대신 결과 텍스트를 후처리로 필터링하는 쪽으로 방향을 바꿨다.

적용한 후처리는 세 단계다. 먼저 "[몇 번째]", "[두 번째 공격]"처럼 대괄호로 둘러싸인 텍스트를 정규식으로 없앤다. 그다음 "뉴스", "구독", "좋아요", "시청해주셔서" 같은 키워드가 들어간 문장을 문장 단위로 걸러낸다. 마지막으로 "MBC 뉴스", "구독과 좋아요", "채널 구독"처럼 좀 더 구체적인 환각 문구 패턴에 걸리면 그 구간 결과를 통째로 버리는 최종 안전장치를 뒀다. 부분적으로만 잘라내지 않고 통째로 버리는 이유는, 환각은 보통 문장 전체가 지어내진 것이라 일부만 남기면 오히려 더 부자연스러운 문장이 되기 때문이다.

```js
// public/whisper-worker.js — 대괄호 텍스트 제거
function stripBracketedText(text) {
  if (!text) return text;
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}
```

```js
// public/whisper-worker.js — 키워드 포함 문장 단위 제거
const HALLUCINATION_KEYWORDS = ['뉴스', '구독', '좋아요', '시청해주셔서', '시청해 주셔서'];

function splitSentences(text) {
  return text.split(/[.!?。\n]+/).map((s) => s.trim()).filter(Boolean);
}

function removeHallucinatedSentences(text) {
  const sentences = splitSentences(text);
  const kept = sentences.filter(
    (s) => !HALLUCINATION_KEYWORDS.some((kw) => s.includes(kw)),
  );
  return kept.join(' ');
}
```

```js
// public/whisper-worker.js — 구체적인 환각 문구 패턴에 대한 최종 안전장치
const HALLUCINATION_PATTERNS = [
  /(MBC|KBS|SBS|YTN|JTBC)\s*뉴스/i,
  /뉴스\s*[가-힣]{2,4}(입니다|였습니다)/,
  /구독\s*과\s*좋아요/,
  /채널\s*구독/,
  /시청해\s*주셔서\s*감사합니다/,
  /다음\s*영상에서\s*(만나요|뵙겠습니다)/,
  // ...
];

function isLikelyHallucination(text) {
  return HALLUCINATION_PATTERNS.some((re) => re.test(text));
}
```

현재 최종 설정값

| 항목 | 값 | 위치 |
|---|---|---|
| 모델 | `Xenova/whisper-base` | `whisper-worker.js`의 `MODEL_ID` |
| 디바이스 우선순위 | WebGPU(`dtype: fp32`) 먼저 시도, 실패하면 WASM(`dtype: q8`)으로 폴백 | `whisper-worker.js`의 `getTranscriber()` |
| 청크 분할(롱폼) | `chunk_length_s: 30`, `stride_length_s: 5` | `whisper-worker.js` transcribe 옵션 |
| 반복 억제 | `no_repeat_ngram_size: 3`, `repetition_penalty: 1.3` | `whisper-worker.js` transcribe 옵션 |
| 반복 텍스트 후처리 | `collapseRepeats(text, maxRepeat=3)` | `whisper-worker.js` |
| no_speech_threshold / logprob_threshold | 미지원 (transformers.js 3.0.2에 해당 옵션 자체가 없음) | 해당 없음 |
| 무음 판정 임계값(VAD) | `silenceRms: 0.01` | `mic.js` 생성자 옵션 |
| 구간 확정 무음 시간 | `segmentSilenceMs: 900ms` | `mic.js` 생성자 옵션 |
| 자동 종료 무음 시간 | `autoStopMs: 10000ms` | `mic.js` 생성자 옵션 |
| 최소 세그먼트 길이 | `minSegmentSec: 0.6초` | `mic.js` 생성자 |
| 오디오 샘플레이트 | 16000Hz | `mic.js`의 `TARGET_SR` |
| 환각 방지 필터 | 대괄호 제거 + 키워드 5종 문장 필터 + 구체 패턴 12종 전체 폐기 | `whisper-worker.js` |

참고: 온디바이스 STT의 알려진 한계

이렇게 여러 겹으로 안전장치를 둬도 Whisper의 환각 현상은 완전히 사라지지 않는다. 블랙리스트 필터는 결국 이미 겪어본 패턴에 대한 사후 대응이라, 학습 데이터에 있었을 법한 다른 문구가 새로운 형태로 튀어나오면 못 걸러낼 수 있다. 또 온디바이스 방식은 사용자의 로컬 기기 자원으로 추론을 돌리기 때문에, 강력한 GPU 서버에서 배치

---
## Backend

회의 내용을 **로컬에서 비식별화(토큰화)** 한 뒤, 백엔드는 토큰만 받아 LLM으로
**회의 요약 + 액션아이템**을 만들고, 그 액션아이템을 그대로 **할일 대시보드**로 이어붙이는 API 서버입니다.

> 코드게이트 AI 스타트업 해커톤 — 팀 TRACEGATE / 서비스 VeilNote
> 이 저장소는 **백엔드 · LLM API** + **토큰화 신뢰성(3단 방어)** 파트입니다. 프론트엔드는 별도 담당입니다.

### 핵심 스토리 — "회의만 하고 끝"이 아니라 "회의 → 실제 업무"

```
회의 전문(토큰화)  ──LLM 1회──▶  전사 교정 · 요약 · 결정사항 · 액션아이템  ──▶  할일 대시보드(체크박스)
                                                                        추가 AI 호출 없음
```

액션아이템은 처음부터 JSON 구조(담당자·우선순위·상대 마감일 + **각각의 근거**)로 뽑히기 때문에,
텍스트 파싱 없이 그대로 할일 레코드가 됩니다. 사용자는 체크박스로 완료 처리만 하면 됩니다.

담당자·우선순위·마감일에는 **근거(`ownerReason`/`priorityReason`/`dueReason`)** 가 항상 따라붙습니다.
화면에 근거를 같이 보여주면 "AI가 멋대로 배정했다"는 거부감이 사라집니다.

### 인식률 보완이 보안 컨셉과 충돌하지 않는 이유

온디바이스 Whisper는 서버 STT보다 정확도가 낮습니다. 보통은 "정확도를 올리려면 오디오를 서버로 보내야 한다"는
딜레마에 빠지는데, VeilNote는 **이미 하고 있는 요약 호출에 교정 지시를 한 줄 얹어** 이를 피합니다.

```
오디오 ─ 기기 밖으로 안 나감
  └▶ Whisper 전사(오탈자 포함) ─ 기기
        └▶ 토큰화 ─ 기기
              └▶ 서버·LLM: 문맥으로 교정 → 그 교정본으로 요약   ← 여기서 처음 네트워크를 탐
```

교정은 **이미 비식별화된 텍스트 위에서만** 일어나므로 프라이버시 서사가 깨지지 않고,
같은 호출 안에서 처리되므로 **추가 비용도 없습니다.** 대괄호 토큰은 교정 대상에서 제외하고
(프롬프트 금지 + 서버측 검사), 응답의 `corrections`로 무엇을 고쳤는지 사용자에게 보여줍니다.

### 토큰화 3단 방어 — "취약점을 기능으로"

규칙 기반 정규식만으로는 데모에서 하나만 놓쳐도 신뢰가 무너집니다. 그래서 3단으로 보강했습니다.

```
① 하이브리드 탐지        규칙(금액·전화·이메일·주민번호·카드·날짜)  +  온디바이스 한국어/다국어 NER
   (regex + ML)           = src/shared/detector.js                    = 브라우저 transformers.js
        │                    회사명·인명처럼 문맥 의존 개체까지 커버리지 확대
        ▼
② 사람이 확정 (HITL)      탐지 결과를 화면에 하이라이트 → "가려/놔둬/직접 추가"를 사용자가 확정
        │                  → 자동 탐지가 완벽할 필요 없어짐. 빠뜨림 위험이 "사용자 통제"라는 기능으로 전환.
        ▼
③ 역방향 유출검사         (A) 클라이언트: 매핑의 원본 값이 텍스트에 남아있으면 전송 차단  ← 원본 아는 쪽만 가능
   (전송 전 게이트)        (B) 서버: 매핑 없이도 잔여 PII 패턴 발견 시 LLM 전송 차단 (422)
        ▼
                          토큰만 LLM으로 → 요약·액션아이템 → 기기에서 복원
```

②와 ③(A)는 브라우저가, ③(B)는 백엔드(`/api/process-meeting` 게이트)가 담당합니다.
`src/shared/*` 는 Node 의존성 없는 순수 ESM이라 **백엔드와 브라우저가 동일 코드**를 씁니다
(서버는 `import`, 브라우저는 `/shared/*.js` 로 로드). 탐지·토큰화·유출검사의 단일 진실원.

### 빠른 시작

```bash
cd veilnote-backend
npm install

# 키 설정: .env 에 실제 키를 넣으세요 (.env 는 .gitignore 됨)
cp .env.example .env      # 그리고 .env 안의 ANTHROPIC_API_KEY 를 실제 값으로

npm start                 # http://localhost:3000  (API 전용, 정적 파일 서빙 없음)
npm run demo              # CLI 엔드투엔드 데모
```

`npm run demo` — 탐지·토큰화·2겹 유출검사(반례 차단 포함)·LLM 처리·할일 적재·체크 완료·복원을 순서대로 출력합니다.
`ANTHROPIC_API_KEY`가 없으면 LLM 직전 단계까지만 시연합니다.

### API

전체 명세는 [`docs/API_SPEC.md`](docs/API_SPEC.md) 참고.

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | 서비스 상태·모델·API 키 설정 여부 |
| `POST /api/process-meeting` | **메인.** 토큰화 회의록 → 요약·결정·액션아이템, 액션아이템은 할일로 자동 적재 |
| `GET /api/tasks` | 할일 목록 + 집계 (미완료 먼저, P1→P3 정렬) |
| `PATCH /api/tasks/:id` | **체크박스 토글** (`{"status":"done"}`) 및 담당자·우선순위 수동 수정 |
| `DELETE /api/tasks/:id` | 할일 삭제 |
| `POST /api/demo/{detect,tokenize,restore}` | ⚠️ 데모 전용 (실서비스는 브라우저가 담당) |

할일 저장소는 **인메모리**입니다 — 서버를 재시작하면 초기화됩니다 (디스크 무저장 정책 유지).

### 파일 구조

```
veilnote-backend/
├─ src/
│  ├─ server.js            Express · 엔드포인트 · 서버측 유출 게이트 (API 전용)
│  ├─ meetingProcess.js    Claude 연동 · 시스템 프롬프트 · JSON Schema (토큰 보존 강제)
│  ├─ taskStore.js         할일 대시보드 인메모리 저장소 (적재/조회/토글/집계)
│  └─ shared/              ⭐ 브라우저·서버 공용 순수 모듈
│     ├─ detector.js       레이어 ① 규칙 탐지 + 겹침 해소 + 마스킹
│     ├─ tokenizer.js      규칙+사전+NER 병합 → 토큰화/복원
│     └─ leakGuard.js      레이어 ③ (A)원본대조 / (B)잔여 PII 스캔
├─ scripts/demo.js         CLI 엔드투엔드 데모
└─ .env.example
```

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (필수) | Claude API 키. 백엔드 전용, 클라이언트 미노출. |
| `VEILNOTE_MODEL` | `claude-opus-4-8` | 모델 ID. 데모 비용 절감 시 `claude-sonnet-5` 권장. |
| `VEILNOTE_EFFORT` | `medium` | 추론 강도: low/medium/high/xhigh/max. |
| `PORT` | `3000` | 서버 포트. |

### 구현 범위

- ✅ 백엔드 프록시(Express) + LLM 연동 — 토큰화 텍스트 → 교정·요약·결정·액션아이템 (호출 1회)
- ✅ **LLM 후처리 전사 교정** — 온디바이스 STT 오인식을 문맥으로 보정, 토큰은 서버측 가드로 보호
- ✅ **액션아이템 → 할일 대시보드** — 체크박스 완료/미완료, 담당자·우선순위 수동 수정, 집계
- ✅ 토큰 보존(구조화 출력) · 무저장 · 키 격리 · 절대 날짜 생성 금지(상대일수)
- ✅ **하이브리드 탐지(규칙+NER) 공용 모듈** · **2겹 역방향 유출 게이트**
- ⬜ 할일 영속화, 프론트엔드 UI — 별도 파트

--로 처리하는 서버 기반 STT API에 비하면 특히 저사양 기기나 WebGPU를 못 써서 WASM으로 폴백하는 환경에서는 인식 속도가 느릴 수밖에 없다. 이 정도 트레이드오프는 음성 데이터가 브라우저 밖으로 전혀 안 나간다는 원칙을 지키기 위해 의도적으로 감수한 것이다.
