// public/mic.js는 Vite 번들링을 거치지 않는 정적 파일이라(내부에서 /whisper-worker.js,
// /pcm-worklet.js를 절대경로로 참조) 런타임에 동적 import(/mic.js)로 불러온다.
// "/"로 시작하는 경로형 specifier는 TS가 앰비언트 모듈 선언으로 매칭해주지 않고 실제
// 파일 경로로만 해석하려 하므로, declare module 대신 평범한 타입만 export하고
// 호출부에서 동적 import 결과를 이 타입으로 캐스팅해서 쓴다.

export interface MeetingRecorderReadyInfo {
  device?: "webgpu" | "wasm";
  model?: string;
}

export interface MeetingRecorderProgressInfo {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface MeetingRecorderOptions {
  onSegment?: (text: string) => void;
  onStatus?: (state: string) => void;
  onSpeaking?: (active: boolean) => void;
  onReady?: (info: MeetingRecorderReadyInfo) => void;
  onProgress?: (progress: MeetingRecorderProgressInfo) => void;
  onAutoStop?: () => void;
  onError?: (message: string) => void;
  autoStopMs?: number;
  segmentSilenceMs?: number;
  silenceRms?: number;
  webgpu?: boolean;
}

export interface MeetingRecorder {
  ready: boolean;
  recording: boolean;
  preload(): Promise<MeetingRecorderReadyInfo>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

export interface MicModule {
  MeetingRecorder: new (opts?: MeetingRecorderOptions) => MeetingRecorder;
}
