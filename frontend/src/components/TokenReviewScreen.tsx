import { useMemo, useState } from "react";
import type { DetectedEntity, EntityType } from "../types";
import { tokenizeFromEntities } from "../lib/tokenizer";

interface TokenReviewScreenProps {
  originalText: string;
  entities: DetectedEntity[];
  onToggle: (id: string) => void;
  onAddCustom: (type: EntityType, value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const TYPE_LABEL: Record<EntityType, string> = {
  ORG: "회사·고객사",
  PERSON: "인명",
  AMOUNT: "금액",
};

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

interface Segment {
  text: string;
  entity: DetectedEntity | null;
}

function buildSegments(originalText: string, sortedEntities: DetectedEntity[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const entity of sortedEntities) {
    if (entity.start > cursor) segments.push({ text: originalText.slice(cursor, entity.start), entity: null });
    segments.push({ text: originalText.slice(entity.start, entity.end), entity });
    cursor = entity.end;
  }
  if (cursor < originalText.length) segments.push({ text: originalText.slice(cursor), entity: null });
  return segments;
}

export default function TokenReviewScreen({
  originalText,
  entities,
  onToggle,
  onAddCustom,
  onConfirm,
  onBack,
}: TokenReviewScreenProps) {
  const [customType, setCustomType] = useState<EntityType>("ORG");
  const [customValue, setCustomValue] = useState("");

  const sortedEntities = useMemo(() => [...entities].sort((a, b) => a.start - b.start), [entities]);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    sortedEntities.forEach((entity, index) => map.set(entity.id, index + 1));
    return map;
  }, [sortedEntities]);

  // 실제 전송 없이, 지금 확정된(포함된) 항목만으로 토큰을 미리 계산해서 보여준다.
  // → "삼성전자가 [ORG_1]로 바뀐다"를 확정하기 전에 미리 확인할 수 있다.
  const tokenPreviewByKey = useMemo(() => {
    const preview = tokenizeFromEntities(originalText, entities);
    return new Map(preview.mappings.map((m) => [`${m.type}:${m.original}`, m.token]));
  }, [originalText, entities]);

  const segments = buildSegments(originalText, sortedEntities);
  const includedCount = entities.filter((e) => e.included).length;

  const handleAddCustom = () => {
    if (!customValue.trim()) return;
    onAddCustom(customType, customValue);
    setCustomValue("");
  };

  return (
    <div className="vn-page vn-page--review">
      <div className="result-header-copy">
        <h1 className="result-title">가릴 항목을 확인해주세요</h1>
        <p className="result-subtitle">
          자동으로 찾은 민감정보 후보입니다. 아래 목록에서 각 항목이 어떤 유형·토큰으로 바뀌는지 확인하고, 잘못
          찾았으면 제외하거나 놓친 항목은 직접 추가하세요.
        </p>
      </div>

      <section className="result-step-card">
        <h2 className="result-step-title">
          탐지된 항목 {entities.length}건 · 가림 {includedCount}건
        </h2>

        {entities.length === 0 ? (
          <p className="review-empty-note">자동으로 탐지된 민감정보가 없습니다. 필요하면 아래에서 직접 추가하세요.</p>
        ) : (
          <>
            <p className="highlighted-text">
              {segments.map((segment, index) =>
                segment.entity ? (
                  <button
                    type="button"
                    key={index}
                    className={`highlight highlight-toggle highlight--${segment.entity.type.toLowerCase()} ${
                      segment.entity.included ? "" : "highlight--excluded"
                    }`}
                    title={`${TYPE_LABEL[segment.entity.type]} · 클릭해서 ${segment.entity.included ? "가리지 않기" : "가리기"}`}
                    onClick={() => onToggle(segment.entity!.id)}
                  >
                    {segment.text}
                    <sup className="review-highlight-index">{indexById.get(segment.entity.id)}</sup>
                  </button>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </p>

            <ul className="review-detection-list">
              {sortedEntities.map((entity) => {
                const token = entity.included
                  ? tokenPreviewByKey.get(`${entity.type}:${entity.text}`)
                  : undefined;
                return (
                  <li key={entity.id} className="review-detection-item">
                    <span className="review-detection-index">{indexById.get(entity.id)}</span>
                    <span className={`review-detection-type review-detection-type--${entity.type.toLowerCase()}`}>
                      {TYPE_LABEL[entity.type]}
                    </span>
                    <span className="review-detection-text">{entity.text}</span>
                    <span className="review-detection-arrow">→</span>
                    {entity.included ? (
                      <span className="review-detection-token">{token}</span>
                    ) : (
                      <span className="review-detection-token review-detection-token--excluded">
                        가리지 않음 (원문 그대로 전송)
                      </span>
                    )}
                    <button type="button" className="review-detection-toggle" onClick={() => onToggle(entity.id)}>
                      {entity.included ? "가리지 않기" : "다시 가리기"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="review-add-form">
          <select
            className="review-add-select"
            value={customType}
            onChange={(e) => setCustomType(e.target.value as EntityType)}
          >
            <option value="ORG">회사·고객사</option>
            <option value="PERSON">인명</option>
            <option value="AMOUNT">금액</option>
          </select>
          <input
            className="review-add-input"
            type="text"
            placeholder="놓친 항목을 직접 입력하세요 (예: 회사 별칭, 이름)"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
          />
          <button type="button" className="review-add-btn" onClick={handleAddCustom}>
            추가
          </button>
        </div>
      </section>

      <div className="card-footer-row">
        <button type="button" className="btn-secondary" onClick={onBack}>
          다시 입력하기
        </button>
        <button type="button" className="btn-analyze" onClick={onConfirm}>
          이 내용으로 진행
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}
