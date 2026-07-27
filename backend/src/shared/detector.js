// 개체 탐지 — 규칙(정규식) 레이어 ①
//
// 순수 ESM 모듈: Node(백엔드)와 브라우저(클라이언트) 양쪽에서 그대로 import 됩니다.
// 문맥 의존 개체(회사명·인명)는 여기서 잡지 않고, 브라우저의 온디바이스 NER가 담당합니다.
// (tokenizer.buildDetections 가 규칙 + 사전 + NER 결과를 합칩니다.)

// 각 규칙: { type, confidence, regex(global) }
// 신뢰도가 높은(모호하지 않은) PII일수록 confidence를 높게 둔다.
export const REGEX_RULES = [
  // 주민등록번호 6-1자리 (YYMMDD-#######)
  { type: 'RRN', confidence: 0.99, regex: /\b\d{6}[-\s]?[1-4]\d{6}\b/g },
  // 카드번호 16자리
  { type: 'CARD', confidence: 0.92, regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  // 이메일
  {
    type: 'EMAIL',
    confidence: 0.98,
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  // 전화번호 (휴대폰/유선)
  {
    type: 'PHONE',
    confidence: 0.9,
    regex: /\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g,
  },
  // 금액: "1억 2천만원", "3,000만원", "$50,000", "50000달러" 등
  {
    type: 'MONEY',
    confidence: 0.8,
    regex:
      /(?:\$\s?[\d,]+(?:\.\d+)?)|(?:[\d,]+\s?억(?:\s?[\d,]+\s?(?:천만|백만|만))?\s?원?)|(?:[\d,]+\s?(?:천만|백만|만)?\s?(?:원|달러|USD|KRW))/g,
  },
  // 날짜: 2026-03-05 / 2026.3.5 / 2026년 3월 5일 / 3월 5일
  {
    type: 'DATE',
    confidence: 0.65,
    regex:
      /(?:\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})|(?:\d{4}년\s?\d{1,2}월(?:\s?\d{1,2}일)?)|(?:\d{1,2}월\s?\d{1,2}일)/g,
  },
];

/**
 * 정규식으로 개체를 탐지한다.
 * @param {string} text
 * @returns {Array<{type,value,start,end,source,confidence}>}
 */
export function detectByRegex(text) {
  const out = [];
  for (const rule of REGEX_RULES) {
    rule.regex.lastIndex = 0;
    let m;
    while ((m = rule.regex.exec(text)) !== null) {
      const value = m[0];
      if (!value) {
        rule.regex.lastIndex++;
        continue;
      }
      out.push({
        type: rule.type,
        value,
        start: m.index,
        end: m.index + value.length,
        source: 'regex',
        confidence: rule.confidence,
      });
    }
  }
  return out;
}

/**
 * 겹치는 탐지 결과를 정리한다 (신뢰도 높은 것 우선, 동률이면 더 긴 것).
 * @param {Array} detections
 * @returns {Array} 시작 위치 오름차순, 서로 겹치지 않는 탐지들
 */
export function resolveOverlaps(detections) {
  const sorted = [...detections].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.end - b.start - (a.end - a.start);
  });
  const kept = [];
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  for (const d of sorted) {
    if (!kept.some((k) => overlaps(k, d))) kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * 로그·응답에 원문 PII를 그대로 노출하지 않도록 마스킹한다.
 * @param {string} value
 */
export function maskValue(value) {
  if (!value) return '';
  if (value.length <= 2) return value[0] + '*';
  return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
}
