import type { Segment } from "../lib/highlight";

const TYPE_LABEL: Record<string, string> = {
  ORG: "회사·고객사",
  PERSON: "인명",
  AMOUNT: "금액",
};

interface HighlightedTextProps {
  segments: Segment[];
}

export default function HighlightedText({ segments }: HighlightedTextProps) {
  return (
    <p className="highlighted-text">
      {segments.map((segment, index) =>
        segment.type ? (
          <span
            key={index}
            className={`highlight highlight--${segment.type.toLowerCase()}`}
            title={TYPE_LABEL[segment.type]}
          >
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
