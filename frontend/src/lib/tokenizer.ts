import type { Correction, DetectedEntity, EntityType, TokenMapping, TokenizeResult } from "../types";

interface RawMatch {
  start: number;
  end: number;
  text: string;
  type: EntityType;
}

// 데모에서 안정적으로 인식되도록 등록해둔 유명 기업/기관명 사전.
// 정규식만으로 잡기 어려운 실제 회사명을 보완하기 위한 용도이며 완전한 목록은 아니다.
const KNOWN_ORGS = [
  "삼성전자",
  "삼성",
  "LG전자",
  "LG",
  "SK하이닉스",
  "SK텔레콤",
  "SK",
  "현대자동차",
  "현대",
  "카카오",
  "네이버",
  "쿠팡",
  "배달의민족",
  "우아한형제들",
  "토스",
  "롯데",
  "한화",
  "포스코",
  "신한은행",
  "국민은행",
  "하나은행",
  "우리은행",
  "구글",
  "애플",
  "마이크로소프트",
  "아마존",
  "메타",
  "테슬라",
];

// 회사명 뒤에 흔히 붙는 접미사 — 사전에 없는 임의의 회사/고객사명을 잡아내기 위한 패턴.
const ORG_SUFFIXES = [
  "주식회사",
  "홀딩스",
  "코퍼레이션",
  "테크놀로지스",
  "테크놀로지",
  "시스템즈",
  "솔루션즈",
  "인더스트리",
  "엔터프라이즈",
  "컴퍼니",
];

// 한국 성씨 — 인명 패턴 매칭의 시작 글자로 사용.
const SURNAMES = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "조",
  "윤",
  "장",
  "임",
  "한",
  "오",
  "서",
  "신",
  "권",
  "황",
  "안",
  "송",
  "전",
  "홍",
  "유",
  "고",
  "문",
  "양",
  "손",
  "배",
  "백",
  "허",
  "남",
  "심",
  "노",
  "하",
  "곽",
  "성",
  "차",
  "주",
  "우",
  "구",
];

// 인명 뒤에 흔히 붙는 직함/조사 — 이 뒤에 성씨+이름이 오면 인명으로 판단.
const PERSON_SUFFIXES = [
  "님",
  "씨",
  "대리",
  "과장",
  "차장",
  "부장",
  "팀장",
  "이사",
  "대표",
  "사원",
  "매니저",
  "실장",
  "본부장",
  "사장",
  "회장",
  "주임",
  "책임",
  "수석",
  "팀원",
];

const PERSON_PARTICLES = ["이", "가", "은", "는", "을", "를", "와", "과", "의", "께", "에게", "한테"];

// 인명 패턴에 자주 오탐되는 일반 단어 — 최종 필터링에 사용.
const PERSON_STOPWORDS = new Set([
  "우리", "저희", "이번", "이것", "이런", "이후", "이전", "이유", "이해", "이상", "이하",
  "정도", "정말", "정리", "정확", "고객", "고민", "고려", "하나", "하지", "현재", "이야기",
]);

// 조직/부서 단위를 나타내는 마지막 음절 — 조사 결합 패턴에서 인명 오탐을 줄이기 위한 필터.
const ORG_UNIT_ENDINGS = new Set(["팀", "부", "과", "실", "국", "처", "관", "소"]);

// ㈜ 접두 형태로 회사명을 잡을 때 뒤에 붙는 조사가 함께 캡처되는 것을 방지.
const TRAILING_PARTICLES = ["으로", "에서", "에게", "한테", "까지", "부터", "이나", "은", "는", "이", "가", "을", "를", "와", "과", "의", "도", "만", "로"];

function trimTrailingParticles(text: string, minLength = 2): string {
  let result = text;
  let changed = true;
  while (changed && result.length > minLength) {
    changed = false;
    for (const particle of TRAILING_PARTICLES) {
      if (result.endsWith(particle) && result.length - particle.length >= minLength) {
        result = result.slice(0, -particle.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAmountMatches(text: string): RawMatch[] {
  const units = ["천만원", "백만원", "억원", "만원", "억", "원", "달러", "USD"];
  const pattern = new RegExp(
    `\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s?(?:${units.join("|")})`,
    "g",
  );
  const matches: RawMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: "AMOUNT" });
  }
  return matches;
}

function findOrgDictMatches(text: string): RawMatch[] {
  const sorted = [...KNOWN_ORGS].sort((a, b) => b.length - a.length);
  const matches: RawMatch[] = [];
  for (const org of sorted) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(org, from);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + org.length, text: org, type: "ORG" });
      from = idx + org.length;
    }
  }
  return matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
}

function findOrgSuffixMatches(text: string): RawMatch[] {
  const suffixPattern = ORG_SUFFIXES.map(escapeRegExp).join("|");
  const matches: RawMatch[] = [];

  // ㈜ / (주) 접두 형태 — 뒤따르는 조사가 함께 잡히지 않도록 트리밍한다.
  const prefixPattern = /(?:㈜|\(주\))\s?[가-힣A-Za-z0-9]{1,12}/g;
  let m: RegExpExecArray | null;
  while ((m = prefixPattern.exec(text)) !== null) {
    const trimmed = trimTrailingParticles(m[0]);
    matches.push({ start: m.index, end: m.index + trimmed.length, text: trimmed, type: "ORG" });
  }

  // OO주식회사 / OO홀딩스 형태 — 접미어가 그대로 끝에 오므로 트리밍이 필요 없다.
  const suffixFormPattern = new RegExp(`[가-힣A-Za-z0-9]{1,12}\\s?(?:${suffixPattern})`, "g");
  while ((m = suffixFormPattern.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: "ORG" });
  }

  return matches;
}

function findPersonMatches(text: string): RawMatch[] {
  const surnamePattern = SURNAMES.join("|");
  const titlePattern = PERSON_SUFFIXES.map(escapeRegExp).join("|");
  const particlePattern = PERSON_PARTICLES.map(escapeRegExp).join("|");
  // 1) 성+이름 뒤에 (공백 후) 직함/존칭이 오는 경우 — 가장 신뢰도 높은 패턴
  // 2) 성+정확히 2음절 이름 뒤에 조사가 공백 없이 바로 붙는 경우 (신뢰도가 낮아 추가 필터링함)
  const pattern = new RegExp(
    `(?<title>(?:${surnamePattern})[가-힣]{1,2})(?=\\s?(?:${titlePattern}))` +
      `|(?<particle>(?:${surnamePattern})[가-힣]{2})(?=(?:${particlePattern})(?![가-힣]))`,
    "g",
  );
  const matches: RawMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const matched = m[0];
    if (PERSON_STOPWORDS.has(matched)) continue;
    if (m.groups?.particle && ORG_UNIT_ENDINGS.has(matched[matched.length - 1])) continue;
    matches.push({ start: m.index, end: m.index + matched.length, text: matched, type: "PERSON" });
  }
  return matches;
}

function collectMatches(text: string): RawMatch[] {
  const claimed: Array<[number, number]> = [];
  const result: RawMatch[] = [];
  const passes = [findAmountMatches, findOrgDictMatches, findOrgSuffixMatches, findPersonMatches];

  for (const pass of passes) {
    for (const match of pass(text)) {
      const overlaps = claimed.some(([s, e]) => match.start < e && match.end > s);
      if (!overlaps) {
        claimed.push([match.start, match.end]);
        result.push(match);
      }
    }
  }

  return result.sort((a, b) => a.start - b.start);
}

let detectionSeq = 0;

/**
 * 규칙 기반으로 민감정보 후보를 탐지한다 (토큰화 전 사람이 검토·확정하는 HITL 단계용).
 * 자동 탐지가 전부 맞을 필요는 없다 — 검토 화면에서 사용자가 가릴지/놔둘지 최종 확정한다.
 */
export function detectEntities(text: string): DetectedEntity[] {
  return collectMatches(text).map((match) => ({
    ...match,
    id: `auto_${detectionSeq++}`,
    source: "auto" as const,
    included: true,
  }));
}

/**
 * 사용자가 "직접 추가"한 용어를 자동 탐지와 같은 형식으로 변환한다.
 * 이미 확정된 구간과 겹치는 위치는 건너뛴다.
 */
export function findCustomEntities(
  text: string,
  type: EntityType,
  value: string,
  existing: DetectedEntity[],
): DetectedEntity[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const claimed: Array<[number, number]> = existing.map((e) => [e.start, e.end]);
  const result: DetectedEntity[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(trimmed, from);
    if (idx === -1) break;
    const end = idx + trimmed.length;
    const overlaps = claimed.some(([s, e]) => idx < e && end > s);
    if (!overlaps) {
      result.push({
        id: `manual_${detectionSeq++}`,
        start: idx,
        end,
        text: trimmed,
        type,
        source: "manual",
        included: true,
      });
      claimed.push([idx, end]);
    }
    from = idx + trimmed.length;
  }
  return result;
}

/** 확정(포함)된 탐지 목록만으로 텍스트를 토큰화한다. 제외 처리된 항목은 원문 그대로 남는다. */
export function tokenizeFromEntities(text: string, entities: DetectedEntity[]): TokenizeResult {
  const matches = entities
    .filter((e) => e.included)
    .slice()
    .sort((a, b) => a.start - b.start);

  const mappings: TokenMapping[] = [];
  const tokenByKey = new Map<string, string>();
  const counters: Record<EntityType, number> = { ORG: 0, PERSON: 0, AMOUNT: 0 };

  let tokenizedText = "";
  let cursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue; // 방어적: 겹침 스킵
    tokenizedText += text.slice(cursor, match.start);
    const key = `${match.type}:${match.text}`;
    let token = tokenByKey.get(key);
    if (!token) {
      counters[match.type] += 1;
      token = `[${match.type}_${counters[match.type]}]`;
      tokenByKey.set(key, token);
      mappings.push({ token, type: match.type, original: match.text });
    }
    tokenizedText += token;
    cursor = match.end;
  }
  tokenizedText += text.slice(cursor);

  return { tokenizedText, mappings };
}

/**
 * 회사명·고객사명·금액·인명 등 민감정보를 [ORG_1], [AMOUNT_1] 같은 토큰으로 치환한다.
 * 순수 함수 — 동일 입력에 대해 항상 동일 결과를 반환하며 외부 상태를 변경하지 않는다.
 * 사람이 검토할 필요 없이 곧바로 토큰화하는 간편 버전 — 검토 화면에서는
 * detectEntities + tokenizeFromEntities를 대신 사용한다.
 */
export function tokenizeText(text: string): TokenizeResult {
  return tokenizeFromEntities(text, detectEntities(text));
}

/** 토큰화된 텍스트를 토큰-원문 매핑을 이용해 실제 값으로 복원한다. */
export function restoreText(text: string, mappings: TokenMapping[]): string {
  let result = text;
  for (const mapping of mappings) {
    result = result.split(mapping.token).join(mapping.original);
  }
  return result;
}

/** 임의의 JSON 값(문자열/배열/객체) 내부의 모든 문자열에 대해 토큰을 복원한다. */
export function restoreDeep<T>(value: T, mappings: TokenMapping[]): T {
  if (typeof value === "string") {
    return restoreText(value, mappings) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => restoreDeep(item, mappings)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = restoreDeep(v, mappings);
    }
    return result as T;
  }
  return value;
}

/**
 * 백엔드가 알려준 전사 교정(before→after)을 텍스트에 순서대로 반영한다.
 * corrections는 온디바이스 음성인식(STT) 오타를 AI가 문맥으로 고친 실제 단어 쌍이라,
 * 토큰화 전 원문에도 그대로 적용된다.
 */
export function applyCorrections(text: string, corrections: Correction[]): string {
  let result = text;
  for (const { before, after } of corrections) {
    if (!before) continue;
    result = result.split(before).join(after);
  }
  return result;
}
