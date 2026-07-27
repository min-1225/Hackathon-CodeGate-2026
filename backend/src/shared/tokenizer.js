// 토큰화 파이프라인 — 하이브리드 탐지(규칙+사전+NER) → 토큰 치환
//
// 순수 ESM: 브라우저·서버 공용.
// 실서비스에서 이 로직은 "브라우저"에서 실행되고, 매핑 테이블은 IndexedDB(기기)에만 저장됩니다.

import { detectByRegex, resolveOverlaps } from './detector.js';

/**
 * 사전 기반 탐지 (레이어 ①의 일부: 알려진 민감어)
 * @param {string} text
 * @param {{ [type: string]: string[] }} dictionary  예: { ORG:['테크컴퍼니'], PERSON:['소지윤'] }
 */
export function detectByDictionary(text, dictionary = {}) {
  const out = [];
  for (const [type, words] of Object.entries(dictionary)) {
    for (const word of words) {
      if (!word) continue;
      let idx = 0;
      while ((idx = text.indexOf(word, idx)) !== -1) {
        out.push({
          type: type.toUpperCase(),
          value: word,
          start: idx,
          end: idx + word.length,
          source: 'dictionary',
          confidence: 0.97,
        });
        idx += word.length;
      }
    }
  }
  return out;
}

/**
 * 브라우저 온디바이스 NER 결과를 표준 탐지 형식으로 변환 (레이어 ①: 문맥 의존 개체)
 * @param {string} text
 * @param {Array<{type,value,start?,end?,confidence?}>} nerEntities
 */
export function nerToDetections(text, nerEntities = []) {
  const out = [];
  for (const e of nerEntities) {
    let { start, end } = e;
    if (start == null || end == null) {
      const idx = text.indexOf(e.value);
      if (idx === -1) continue;
      start = idx;
      end = idx + e.value.length;
    }
    out.push({
      type: (e.type || 'MISC').toUpperCase(),
      value: text.slice(start, end),
      start,
      end,
      source: 'ner',
      confidence: e.confidence ?? 0.85,
    });
  }
  return out;
}

/**
 * 규칙 + 사전 + NER 결과를 합쳐 겹침을 해소한 최종 탐지 목록을 만든다.
 * @param {string} text
 * @param {{ dictionary?: object, ner?: Array }} opts
 */
export function buildDetections(text, { dictionary = {}, ner = [] } = {}) {
  const all = [
    ...detectByRegex(text),
    ...detectByDictionary(text, dictionary),
    ...nerToDetections(text, ner),
  ];
  return resolveOverlaps(all);
}

/**
 * 확정된 탐지 목록으로 텍스트를 토큰화한다. (레이어 ② 이후, 사용자가 확정한 detections를 받음)
 * 동일한 원본 값은 같은 토큰으로 재사용된다.
 * @param {string} text
 * @param {Array<{type,value,start,end}>} detections  겹치지 않는 탐지들
 * @returns {{ tokenized: string, mapping: { [token]: string } }}
 */
export function applyTokenization(text, detections) {
  const ordered = [...detections].sort((a, b) => a.start - b.start);
  const mapping = {};
  const reverse = {}; // 원본 -> token (동일 값 재사용)
  const counters = {};

  const tokenFor = (type, value) => {
    if (reverse[value]) return reverse[value];
    counters[type] = (counters[type] || 0) + 1;
    const token = `[${type}_${counters[type]}]`;
    mapping[token] = value;
    reverse[value] = token;
    return token;
  };

  let out = '';
  let cursor = 0;
  for (const d of ordered) {
    if (d.start < cursor) continue; // 방어적: 겹침 스킵
    out += text.slice(cursor, d.start);
    out += tokenFor(d.type, text.slice(d.start, d.end));
    cursor = d.end;
  }
  out += text.slice(cursor);
  return { tokenized: out, mapping };
}

/**
 * 편의 함수: 규칙+사전(+NER)으로 자동 탐지 후 곧바로 토큰화.
 * 사람이 확정하는 단계(HITL)를 건너뛰는 서버 데모/테스트용.
 */
export function tokenize(rawText, dictionary = {}, options = {}) {
  const detections = buildDetections(rawText, {
    dictionary,
    ner: options.ner || [],
  });
  return applyTokenization(rawText, detections);
}

/**
 * 토큰화된(또는 AI가 반환한) 값에서 토큰을 원문으로 복원한다. 문자열/배열/객체 재귀.
 */
export function restore(value, mapping) {
  if (typeof value === 'string') {
    let out = value;
    for (const [token, original] of Object.entries(mapping)) {
      out = out.split(token).join(original);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, mapping));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = restore(v, mapping);
    return out;
  }
  return value;
}
