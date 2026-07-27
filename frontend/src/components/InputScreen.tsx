import { useCallback, useRef, useState } from "react";
import { SAMPLE_MEMO } from "../lib/sampleData";
import { isMeetingRecorderSupported, useMeetingRecorder } from "../hooks/useMeetingRecorder";
import ConsentModal from "./ConsentModal";

interface InputScreenProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export default function InputScreen({ value, onChange, onSubmit, error }: InputScreenProps) {
  const [isSupported] = useState(() => isMeetingRecorderSupported());
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null);
  const [autoStopNotice, setAutoStopNotice] = useState(false);

  const recordingBaseRef = useRef("");
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSegment = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      recordingBaseRef.current = recordingBaseRef.current
        ? `${recordingBaseRef.current} ${chunk}`
        : chunk;
      onChange(recordingBaseRef.current);
    },
    [onChange],
  );

  const handleAutoStop = useCallback(() => {
    setAutoStopNotice(true);
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    autoStopTimerRef.current = setTimeout(() => setAutoStopNotice(false), 6000);
  }, []);

  const {
    isRecording,
    isModelLoading,
    modelLoadProgress,
    error: speechError,
    start,
    stop,
  } = useMeetingRecorder({
    onSegment: handleSegment,
    onAutoStop: handleAutoStop,
  });

  const handleVoiceButtonClick = () => {
    if (!isSupported) return;
    setShowConsentModal(true);
  };

  const handleConsentCancel = () => setShowConsentModal(false);

  const handleConsentConfirm = () => {
    const now = new Date();
    const formatted = formatClock(now);
    console.log(`[VeilNote] 음성 입력 동의 시각: ${formatted}`);
    setConsentTimestamp(formatted);
    setShowConsentModal(false);
    setAutoStopNotice(false);
    recordingBaseRef.current = value ? `${value}\n` : "";
    start();
  };

  return (
    <div className="vn-page vn-page--input">
      <div className="input-card">
        <div className="card-header-row">
          <label className="field-label" htmlFor="memo-input">
            회의 메모
          </label>
          <div className="input-mode-actions">
            <button type="button" className="btn-ghost" onClick={() => onChange(SAMPLE_MEMO)}>
              <SparklesIcon />
              예시 메모 불러오기
            </button>
            <button
              type="button"
              className="btn-voice"
              onClick={handleVoiceButtonClick}
              disabled={!isSupported || isRecording || isModelLoading}
              title={isSupported ? undefined : "이 브라우저에서는 온디바이스 음성 입력을 지원하지 않습니다."}
            >
              <MicIcon />
              음성으로 입력
            </button>
          </div>
        </div>

        {!isSupported && (
          <div className="inline-alert">
            <AlertIcon />
            <span>현재 브라우저에서는 음성 입력을 지원하지 않습니다. Chrome 최신 버전을 사용해주세요.</span>
          </div>
        )}

        {isModelLoading && (
          <div className="voice-status-bar">
            <div className="voice-status-bar-top">
              <span className="spinner spinner--sm" aria-hidden="true" />
              <span className="voice-status-text voice-status-text--loading">음성 모델 준비 중</span>
              <span className="voice-status-percent">{Math.round(modelLoadProgress)}%</span>
            </div>
            <div className="voice-progress-track">
              <div
                className="voice-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, Math.round(modelLoadProgress)))}%` }}
              />
            </div>
          </div>
        )}

        {isRecording && (
          <div className="voice-status-bar voice-status-bar--recording">
            <span className="voice-recording-dot" aria-hidden="true" />
            <span className="voice-status-text">음성을 기록하고 있습니다</span>
            <button type="button" className="voice-stop-btn" onClick={stop}>
              종료
            </button>
          </div>
        )}

        {autoStopNotice && (
          <div className="inline-notice">무음이 감지되어 녹음이 종료되었습니다.</div>
        )}

        {speechError && (
          <div className="inline-alert inline-alert--error">
            <AlertIcon />
            <span>{speechError}</span>
          </div>
        )}

        <textarea
          id="memo-input"
          className="memo-textarea"
          placeholder="예) 오늘 삼성전자 구매팀과 미팅을 진행했고, 김민수 팀장이 계약 금액 3천만원을 제안했다..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
        />
        {error && (
          <div className="inline-alert inline-alert--error">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}
        <div className="card-footer-row">
          <span className="char-count">
            {value.length.toLocaleString()}자
            {consentTimestamp && <span className="consent-timestamp"> · 음성 동의 {consentTimestamp}</span>}
          </span>
          <button type="button" className="btn-analyze" onClick={onSubmit}>
            AI로 안전하게 분석하기
            <ArrowRightIcon />
          </button>
        </div>
      </div>

      {showConsentModal && (
        <ConsentModal onConfirm={handleConsentConfirm} onCancel={handleConsentCancel} />
      )}
    </div>
  );
}
