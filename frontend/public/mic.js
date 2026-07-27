// VeilNote — 마이크 캡처 + 음성구간 감지(VAD) + Whisper 워커 오케스트레이션
//
// 메인 스레드에서 오디오 그래프를 만들고, 무거운 STT 추론은 whisper-worker.js(별도 스레드)에 맡긴다.
// 말이 끊기는(무음) 지점을 경계로 구간을 잘라 워커에 넘겨 준실시간으로 받아쓴다.
// 오디오 원본은 어디에도 저장/전송하지 않는다 — 변환 후 즉시 버린다.

const TARGET_SR = 16000; // Whisper 입력 샘플레이트

/** 선형보간 리샘플: 임의 sampleRate → 16kHz mono */
function resampleTo16k(input, inputSr) {
  if (inputSr === TARGET_SR) return input;
  const ratio = inputSr / TARGET_SR;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function concatFloat32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export class MeetingRecorder {
  /**
   * @param {object} opts
   * @param {(text:string)=>void} opts.onSegment   확정된 구간의 텍스트
   * @param {(state:string)=>void} [opts.onStatus]  상태 문자열
   * @param {(active:boolean)=>void} [opts.onSpeaking]  발화 중 여부(레벨 표시용)
   * @param {(info:{device?:string,model?:string})=>void} [opts.onReady] 모델 로드 완료
   * @param {(p:object)=>void} [opts.onProgress] 모델 다운로드 진행률
   * @param {()=>void} [opts.onAutoStop]  무음 자동 종료 발생
   * @param {(msg:string)=>void} [opts.onError]
   * @param {number} [opts.autoStopMs=10000]  이 시간 이상 무음이 지속되면 자동 종료
   * @param {number} [opts.segmentSilenceMs=900]  이 정도 멈추면 한 구간으로 확정
   * @param {number} [opts.silenceRms=0.01]  이 값 이하이면 무음으로 간주
   * @param {boolean} [opts.webgpu=true]
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.autoStopMs = opts.autoStopMs ?? 10000;
    this.segmentSilenceMs = opts.segmentSilenceMs ?? 900;
    this.silenceRms = opts.silenceRms ?? 0.01;
    // 0.35s처럼 너무 짧은 조각은 Whisper에 문맥이 부족해 반복 루프(같은 단어 무한 반복)를
    // 유발하기 쉽다고 알려져 있어, 잡음 컷 겸 안전 마진으로 조금 더 길게 잡는다.
    this.minSegmentSec = 0.6;
    this.webgpu = opts.webgpu !== false;

    this.worker = null;
    this.ready = false;
    this.recording = false;

    // 워커 전송 직렬화(한 번에 하나씩)
    this._jobId = 0;
    this._queue = [];
    this._inFlight = false;

    // 오디오 그래프
    this.audioCtx = null;
    this.stream = null;
    this.sourceNode = null;
    this.workletNode = null;

    // VAD 상태
    this._segChunks = [];
    this._segSamples = 0;
    this._speaking = false;
    this._silenceSamples = 0; // 현재 구간 내 무음 누적
    this._idleSamples = 0; // 발화 없는 전체 무음 누적(자동종료용)
  }

  _status(s) {
    this.opts.onStatus && this.opts.onStatus(s);
  }

  /** Whisper 워커를 띄우고 모델을 프리로드한다(최초 1회 다운로드). */
  preload() {
    this._ensureWorker();
    return new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
      this.worker.postMessage({ type: 'load', webgpu: this.webgpu });
    });
  }

  _ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker('/whisper-worker.js', { type: 'module' });
    this.worker.onmessage = (e) => this._onWorkerMessage(e.data || {});
    this.worker.onerror = (e) =>
      this.opts.onError && this.opts.onError('워커 오류: ' + (e.message || e));
  }

  _onWorkerMessage(msg) {
    switch (msg.type) {
      case 'progress':
        this.opts.onProgress && this.opts.onProgress(msg.data);
        break;
      case 'device-fallback':
        this._status(`${msg.from} 사용 불가 → WASM으로 폴백`);
        break;
      case 'ready':
        this.ready = true;
        this.opts.onReady && this.opts.onReady({ device: msg.device, model: msg.model });
        this._readyResolve && this._readyResolve({ device: msg.device, model: msg.model });
        this._readyResolve = this._readyReject = null;
        break;
      case 'result':
        this._inFlight = false;
        if (msg.text) this.opts.onSegment && this.opts.onSegment(msg.text);
        this._drain();
        break;
      case 'error':
        this._inFlight = false;
        // 로드 단계 오류면 preload를 reject
        if (this._readyReject) {
          this._readyReject(new Error(msg.error));
          this._readyResolve = this._readyReject = null;
        }
        this.opts.onError && this.opts.onError(msg.error);
        this._drain();
        break;
    }
  }

  _enqueue(audio16k) {
    this._queue.push({ id: ++this._jobId, audio: audio16k });
    this._drain();
  }

  _drain() {
    if (this._inFlight || this._queue.length === 0) return;
    const job = this._queue.shift();
    this._inFlight = true;
    this._status('구간 인식 중…');
    this.worker.postMessage(
      { type: 'transcribe', id: job.id, audio: job.audio, webgpu: this.webgpu, language: 'korean' },
      [job.audio.buffer] // transferable — 복사 없이 이전
    );
  }

  /** 마이크 시작. 반드시 사용자 제스처(동의 후) 안에서 호출. */
  async start() {
    if (this.recording) return;
    this._ensureWorker();
    if (!this.ready) {
      this._status('모델 로딩 중…');
      await this.preload();
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // 가능하면 16kHz로 컨텍스트 생성(브라우저가 무시하면 아래서 리샘플)
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: TARGET_SR,
    });
    // preload()의 모델 다운로드 대기 등 여러 await를 거친 뒤라 브라우저 자동재생 정책상
    // suspended 상태로 생성될 수 있다. suspended 상태면 워클릿이 프레임을 보내지 않으므로
    // 명시적으로 재개한다.
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    await this.audioCtx.audioWorklet.addModule('/pcm-worklet.js');

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-worklet');
    this.workletNode.port.onmessage = (e) => this._onFrame(e.data);
    this.sourceNode.connect(this.workletNode);
    // 워클릿은 출력하지 않지만, 일부 브라우저는 destination 연결이 있어야 process가 돈다
    this.workletNode.connect(this.audioCtx.destination);

    this._resetVad();
    this.recording = true;
    this._status('녹음 중… (말이 끝나면 자동으로 구간이 확정됩니다)');
  }

  _resetVad() {
    this._segChunks = [];
    this._segSamples = 0;
    this._speaking = false;
    this._silenceSamples = 0;
    this._idleSamples = 0;
  }

  _onFrame(frame) {
    if (!this.recording) return;
    const sr = this.audioCtx.sampleRate;
    const level = rms(frame);
    const voiced = level > this.silenceRms;

    if (voiced) {
      this._speaking = true;
      this._silenceSamples = 0;
      this._idleSamples = 0;
      this.opts.onSpeaking && this.opts.onSpeaking(true);
      this._segChunks.push(frame);
      this._segSamples += frame.length;
    } else if (this._speaking) {
      // 발화 뒤 짧은 무음: 꼬리도 담아두되 무음 누적
      this._segChunks.push(frame);
      this._segSamples += frame.length;
      this._silenceSamples += frame.length;
      if (this._silenceSamples >= (this.segmentSilenceMs / 1000) * sr) {
        this._flushSegment();
        this._speaking = false;
        this.opts.onSpeaking && this.opts.onSpeaking(false);
      }
    } else {
      // 발화 전/사이의 무음: 자동종료 카운트
      this._idleSamples += frame.length;
      if (this._idleSamples >= (this.autoStopMs / 1000) * sr) {
        this._status('무음 지속 → 자동 종료');
        this.opts.onAutoStop && this.opts.onAutoStop();
        this.stop();
      }
    }
  }

  _flushSegment() {
    const sr = this.audioCtx ? this.audioCtx.sampleRate : TARGET_SR;
    const samples = this._segSamples;
    const chunks = this._segChunks;
    this._segChunks = [];
    this._segSamples = 0;
    this._silenceSamples = 0;
    if (samples < this.minSegmentSec * sr) return; // 너무 짧으면 버림
    const merged = concatFloat32(chunks);
    const audio16k = resampleTo16k(merged, sr);
    this._enqueue(audio16k);
  }

  /** 녹음 종료. 남은 구간은 마지막으로 한 번 더 인식. */
  async stop() {
    if (!this.recording) return;
    this.recording = false;
    // 마지막 발화 구간 flush(무음 경계가 안 왔어도)
    if (this._segSamples > 0) this._flushSegment();

    try {
      if (this.workletNode) this.workletNode.disconnect();
      if (this.sourceNode) this.sourceNode.disconnect();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.audioCtx) await this.audioCtx.close();
    } catch (_) {
      /* 정리 실패는 무시 */
    }
    this.workletNode = this.sourceNode = this.stream = this.audioCtx = null;
    this.opts.onSpeaking && this.opts.onSpeaking(false);
    this._status('녹음 종료');
  }

  dispose() {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
