import { useState } from "react";
import "./App.css";
import type { DetectedEntity, EntityType, MeetingProcessResult, MeetingRecord, Screen, TokenizeResult } from "./types";
import { detectEntities, findCustomEntities, restoreDeep, tokenizeFromEntities } from "./lib/tokenizer";
import { processMeeting, BackendApiError } from "./lib/claudeApi";
import { loadMeetings, addMeeting, toggleTaskStatus, clearMeetings } from "./lib/meetingStore";
import shieldLogo from "./assets/Logo1.png";
import HomeScreen from "./components/HomeScreen";
import InputScreen from "./components/InputScreen";
import TokenReviewScreen from "./components/TokenReviewScreen";
import ProcessingScreen from "./components/ProcessingScreen";
import ResultScreen from "./components/ResultScreen";
import DashboardScreen from "./components/DashboardScreen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [memoText, setMemoText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [originalText, setOriginalText] = useState("");
  const [detections, setDetections] = useState<DetectedEntity[]>([]);
  const [tokenizeResult, setTokenizeResult] = useState<TokenizeResult | null>(null);
  const [aiRawResult, setAiRawResult] = useState<MeetingProcessResult | null>(null);
  const [aiRestoredResult, setAiRestoredResult] = useState<MeetingProcessResult | null>(null);

  const [meetings, setMeetings] = useState<MeetingRecord[]>(() => loadMeetings());
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);

  const openItemCount = meetings.reduce(
    (sum, m) => sum + m.tasks.filter((task) => task.status !== "done").length,
    0,
  );

  // 자동 탐지 결과를 곧바로 토큰화하지 않고, 사람이 검토·확정(HITL)할 수 있도록
  // 먼저 검토 화면으로 넘긴다. 실제 토큰화는 handleConfirmReview에서 일어난다.
  const handleContinueToReview = () => {
    const trimmed = memoText.trim();
    if (!trimmed) {
      setError("회의·업무 메모를 입력해주세요.");
      return;
    }

    setError(null);
    setOriginalText(trimmed);
    setDetections(detectEntities(trimmed));
    setScreen("review");
  };

  const handleToggleDetection = (id: string) => {
    setDetections((prev) => prev.map((d) => (d.id === id ? { ...d, included: !d.included } : d)));
  };

  const handleAddCustomDetection = (type: EntityType, value: string) => {
    setDetections((prev) => [...prev, ...findCustomEntities(originalText, type, value, prev)]);
  };

  const handleBackToInput = () => {
    setScreen("input");
  };

  const handleConfirmReview = async () => {
    const result = tokenizeFromEntities(originalText, detections);
    setTokenizeResult(result);
    setScreen("processing");

    try {
      const rawResult = await processMeeting(result.tokenizedText);
      const restoredResult: MeetingProcessResult = restoreDeep(rawResult, result.mappings);
      setAiRawResult(rawResult);
      setAiRestoredResult(restoredResult);

      const nextMeetings = addMeeting(
        meetings,
        restoredResult.summary,
        restoredResult.decisions,
        restoredResult.tasks,
        restoredResult.personalStar,
      );
      setMeetings(nextMeetings);
      setCurrentMeetingId(nextMeetings[0].id);

      setScreen("result");
    } catch (err) {
      if (err instanceof BackendApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      }
      setScreen("input");
    }
  };

  const handleToggleTask = (meetingId: string, taskId: string) => {
    setMeetings((prev) => toggleTaskStatus(prev, meetingId, taskId));
  };

  const handleClearMeetings = () => {
    if (!window.confirm("저장된 모든 회의 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setMeetings(clearMeetings());
  };

  const handleReset = () => {
    setMemoText("");
    setError(null);
    setOriginalText("");
    setDetections([]);
    setTokenizeResult(null);
    setAiRawResult(null);
    setAiRestoredResult(null);
    setCurrentMeetingId(null);
    setScreen("input");
  };

  const currentMeeting = meetings.find((m) => m.id === currentMeetingId) ?? null;

  // 홈 화면은 내비게이션 바 없이 뷰포트 전체를 차지하는 완전히 독립적인 첫 페이지
  if (screen === "home") {
    return <HomeScreen onStart={() => setScreen("input")} />;
  }

  return (
    <div className="vn-shell">
      <header className="vn-topbar">
        <button type="button" className="vn-topbar-brand" onClick={() => setScreen("home")}>
          <img src={shieldLogo} alt="" className="vn-topbar-logo" />
          <span className="vn-topbar-wordmark">VeilNote</span>
        </button>
        <nav className="vn-nav">
          <button
            type="button"
            className={`vn-nav-link ${
              screen === "input" || screen === "review" || screen === "processing" || screen === "result"
                ? "vn-nav-link--active"
                : ""
            }`}
            onClick={() => setScreen("input")}
          >
            메모 입력
          </button>
          <button
            type="button"
            className={`vn-nav-link ${screen === "dashboard" ? "vn-nav-link--active" : ""}`}
            onClick={() => setScreen("dashboard")}
          >
            대시보드
            {openItemCount > 0 && <span className="vn-nav-badge">{openItemCount}</span>}
          </button>
        </nav>
      </header>

      <main className="vn-main">
        {screen === "input" && (
          <InputScreen value={memoText} onChange={setMemoText} onSubmit={handleContinueToReview} error={error} />
        )}
        {screen === "review" && (
          <TokenReviewScreen
            originalText={originalText}
            entities={detections}
            onToggle={handleToggleDetection}
            onAddCustom={handleAddCustomDetection}
            onConfirm={handleConfirmReview}
            onBack={handleBackToInput}
          />
        )}
        {screen === "processing" && (
          <ProcessingScreen tokenCount={tokenizeResult?.mappings.length ?? 0} />
        )}
        {screen === "result" && tokenizeResult && aiRawResult && aiRestoredResult && currentMeeting && (
          <ResultScreen
            originalText={originalText}
            tokenizeResult={tokenizeResult}
            aiRawResult={aiRawResult}
            aiRestoredResult={aiRestoredResult}
            tasks={currentMeeting.tasks}
            onToggleTask={(taskId) => handleToggleTask(currentMeeting.id, taskId)}
            onReset={handleReset}
          />
        )}
        {screen === "dashboard" && (
          <DashboardScreen meetings={meetings} onToggle={handleToggleTask} onClear={handleClearMeetings} />
        )}
      </main>
    </div>
  );
}
