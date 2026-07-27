// 역방향 유출 검사 — 레이어 ③ (전송 전 최종 안전장치)
//
// 두 겹으로 방어한다:
//  (A) 클라이언트: 매핑 테이블의 "원본 값"이 토큰화된 텍스트에 하나라도 남아 있으면 전송 차단.
//      → 원본을 아는 쪽(기기)만 할 수 있는, 가장 정확한 검사.
//  (B) 서버: 매핑 테이블 없이도, 들어온 텍스트에 원문 PII 패턴(이메일/전화/주민번호/카드)이
//      남아 있으면 LLM 전송을 구조적으로 차단.
//      → 서버는 원본을 몰라도 "유출을 구조적으로 막는다"는 주장을 실제로 성립시킨다.

import { detectByRegex, maskValue } from './detector.js';

/**
 * (A) 클라이언트용: 매핑의 원본 값이 텍스트에 남아있는지 대조.
 * @param {string} tokenizedText
 * @param {{ [token]: string }} mapping
 * @returns {{ safe: boolean, leaked: Array<{token,original}> }}
 */
export function checkResidualOriginals(tokenizedText, mapping) {
  const leaked = [];
  for (const [token, original] of Object.entries(mapping)) {
    if (original && tokenizedText.includes(original)) {
      leaked.push({ token, original });
    }
  }
  return { safe: leaked.length === 0, leaked };
}

// 서버가 "절대 통과시키면 안 되는" 고신뢰 PII 유형 (모호한 금액/날짜는 경고로만).
export const DEFAULT_BLOCK_TYPES = ['EMAIL', 'PHONE', 'RRN', 'CARD'];

/**
 * (B) 서버용: 토큰화됐다고 주장하는 텍스트에서 잔여 원문 PII 패턴을 탐지.
 * 토큰(예: [EMAIL_1])은 정규식에 걸리지 않으므로, 걸리는 건 "치환되지 않은 진짜 PII"다.
 * @param {string} text
 * @param {{ block?: string[] }} opts
 * @returns {{ clean: boolean, blocking: Array, warnings: Array }}
 */
export function scanResidualPII(text, { block = DEFAULT_BLOCK_TYPES } = {}) {
  const dets = detectByRegex(text);
  const blocking = dets.filter((d) => block.includes(d.type));
  const warnings = dets.filter((d) => !block.includes(d.type));
  return { clean: blocking.length === 0, blocking, warnings };
}

/**
 * 서버 응답용으로 탐지 결과를 마스킹(원문 미노출)해 요약한다.
 */
export function summarizeFindings(findings) {
  return findings.map((f) => ({
    type: f.type,
    preview: maskValue(f.value),
    confidence: f.confidence,
  }));
}
