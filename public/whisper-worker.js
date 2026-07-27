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
      });
      const text = (out && typeof out.text === 'string' ? out.text : '').trim();
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
