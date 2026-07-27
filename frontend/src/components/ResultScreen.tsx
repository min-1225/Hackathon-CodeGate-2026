import { useState } from "react";
import type { MeetingProcessResult, Task, TokenizeResult } from "../types";
import { buildOriginalSegments, buildTokenSegments } from "../lib/highlight";
import { applyCorrections } from "../lib/tokenizer";
import HighlightedText from "./HighlightedText";
import ActionChecklist from "./ActionChecklist";

interface ResultScreenProps {
  originalText: string;
  tokenizeResult: TokenizeResult;
  aiRawResult: MeetingProcessResult;
  aiRestoredResult: MeetingProcessResult;
  tasks: Task[];
  onToggleTask: (taskId: string) => void;
  onReset: () => void;
}

export default function ResultScreen({
  originalText,
  tokenizeResult,
  aiRawResult,
  aiRestoredResult,
  tasks,
  onToggleTask,
  onReset,
}: ResultScreenProps) {
  const [showRaw, setShowRaw] = useState(false);

  const originalSegments = buildOriginalSegments(originalText, tokenizeResult.mappings);
  const tokenSegments = buildTokenSegments(tokenizeResult.tokenizedText);

  // 백엔드가 온디바이스 음성인식(STT) 오타를 문맥으로 교정한 내역을 원문에 그대로 반영한 버전.
  const correctedText = applyCorrections(originalText, aiRestoredResult.corrections);
  const correctedSegments = buildOriginalSegments(correctedText, tokenizeResult.mappings);
  const hasCorrections = aiRestoredResult.corrections.length > 0;

  return (
    <div className="vn-page vn-page--result">
      <div className="result-header-copy">
        <h1 className="result-title">보호 처리 완료</h1>
      </div>

      <section className="result-step-card">
        <h2 className="result-step-title">1단계 · 민감정보 보호 처리</h2>
        <div className="result-compare-grid">
          <div className="result-compare-col">
            <span className="result-compare-label">원문</span>
            <HighlightedText segments={originalSegments} />
          </div>
          <div className="result-compare-arrow">→</div>
          <div className="result-compare-col">
            <span className="result-compare-label">보호 처리본 (AI가 실제로 받은 텍스트)</span>
            <HighlightedText segments={tokenSegments} />
          </div>
        </div>
        <div className="result-legend">
          <span className="result-legend-item">
            <span className="result-legend-swatch result-legend-swatch--org" />
            회사·고객사
          </span>
          <span className="result-legend-item">
            <span className="result-legend-swatch result-legend-swatch--person" />
            인명
          </span>
          <span className="result-legend-item">
            <span className="result-legend-swatch result-legend-swatch--amount" />
            금액
          </span>
        </div>

        {hasCorrections && (
          <div className="result-correction-block">
            <span className="result-compare-label">전사 교정 반영본 (AI가 음성인식 오타를 문맥으로 교정)</span>
            <HighlightedText segments={correctedSegments} />
          </div>
        )}
      </section>

      <section className="result-step-card">
        <h2 className="result-step-title">2단계 · AI 처리 결과 (복원 완료)</h2>

        <h3 className="result-step-subheading">회의 요약</h3>
        <p className="result-summary-text">{aiRestoredResult.summary}</p>

        <h3 className="result-step-subheading">결정 사항</h3>
        {aiRestoredResult.decisions.length > 0 ? (
          <ul className="result-decision-list">
            {aiRestoredResult.decisions.map((decision, index) => (
              <li key={index}>{decision}</li>
            ))}
          </ul>
        ) : (
          <p className="result-info-empty">회의에서 확정된 결정 사항이 없습니다.</p>
        )}

        <h3 className="result-step-subheading">액션 아이템 (할일)</h3>
        <ActionChecklist items={tasks} onToggle={onToggleTask} />

        <button type="button" className="result-raw-toggle" onClick={() => setShowRaw((prev) => !prev)}>
          {showRaw ? "AI 원본 응답 숨기기" : "AI가 실제로 생성한 보호 처리된 내용 보기"}
        </button>
        {showRaw && (
          <div className="result-raw-preview">
            <p className="result-raw-preview-text">{aiRawResult.summary}</p>
            {aiRawResult.decisions.map((decision, index) => (
              <div key={index} className="result-raw-item">
                {decision}
              </div>
            ))}
            {aiRawResult.tasks.map((task) => (
              <div key={task.id} className="result-raw-item">
                {task.text}
                <span className="result-raw-item-owner">담당 제안: {task.ownerToken ?? "미배정"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="result-footer">
        <button type="button" className="btn-analyze" onClick={onReset}>
          새 메모 입력하기
        </button>
      </div>
    </div>
  );
}
