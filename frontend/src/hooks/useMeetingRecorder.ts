import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingRecorder, MeetingRecorderReadyInfo } from "../types/mic-recorder";
import { loadMicModule } from "./loadMicModule";

const AUTO_STOP_MS = 10000;

export function isMeetingRecorderSupported(): boolean {
  if (typeof window === "undefined") return false;
  const hasMic = !!navigator.mediaDevices?.getUserMedia;
  const hasAudioWorklet = !!window.AudioContext && "audioWorklet" in window.AudioContext.prototype;
  const hasWasm = typeof WebAssembly !== "undefined";
  return hasMic && hasAudioWorklet && hasWasm;
}

interface UseMeetingRecorderOptions {
  /** 무음 구간이 감지되어 그때까지의 음성이 텍스트로 변환될 때마다 호출된다. */
  onSegment: (text: string) => void;
  /** 긴 무음이 지속되어 녹음이 자동으로 종료되었을 때 호출된다. */
  onAutoStop: () => void;
}

export function useMeetingRecorder({ onSegment, onAutoStop }: UseMeetingRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [device, setDevice] = useState<MeetingRecorderReadyInfo["device"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MeetingRecorder | null>(null);

  // onSegment/onAutoStop을 매번 새로 넘겨도 MeetingRecorder 인스턴스를 다시 만들지 않도록
  // ref로 최신 콜백을 유지한다.
  const onSegmentRef = useRef(onSegment);
  const onAutoStopRef = useRef(onAutoStop);
  onSegmentRef.current = onSegment;
  onAutoStopRef.current = onAutoStop;

  const getRecorder = useCallback(async (): Promise<MeetingRecorder> => {
    if (recorderRef.current) return recorderRef.current;

    const micModule = await loadMicModule();
    const { MeetingRecorder: MeetingRecorderCtor } = micModule;
    const recorder = new MeetingRecorderCtor({
      autoStopMs: AUTO_STOP_MS,
      onSegment: (text) => onSegmentRef.current(text),
      onAutoStop: () => {
        // mic.js가 자동 종료 시 내부적으로 stop()을 호출해 녹음을 정리하지만, React 쪽
        // isRecording state는 별도로 갱신해줘야 "듣고 있어요" 표시가 꺼진다.
        setIsRecording(false);
        setIsSpeaking(false);
        onAutoStopRef.current();
      },
      onSpeaking: (active) => setIsSpeaking(active),
      onReady: (info) => {
        setIsModelLoading(false);
        setDevice(info.device ?? null);
      },
      onProgress: (progress) => {
        if (progress.status === "progress_total" && typeof progress.progress === "number") {
          setModelLoadProgress(progress.progress);
        }
      },
      onError: (message) => {
        setIsModelLoading(false);
        setError(`온디바이스 음성 모델에 문제가 발생했습니다. (${message})`);
      },
    });

    recorderRef.current = recorder;
    return recorder;
  }, []);

  const start = useCallback(async () => {
    if (!isMeetingRecorderSupported()) {
      setError("이 브라우저에서는 온디바이스 음성 입력이 지원되지 않습니다.");
      return;
    }

    setError(null);
    try {
      const recorder = await getRecorder();
      if (!recorder.ready) {
        setIsModelLoading(true);
        setModelLoadProgress(0);
      }
      await recorder.start();
      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setError(`마이크를 시작할 수 없습니다. (${message})`);
      setIsModelLoading(false);
    }
  }, [getRecorder]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.stop().finally(() => {
      setIsRecording(false);
      setIsSpeaking(false);
    });
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.dispose();
      recorderRef.current = null;
    };
  }, []);

  return {
    isRecording,
    isModelLoading,
    modelLoadProgress,
    isSpeaking,
    device,
    error,
    start,
    stop,
  };
}
