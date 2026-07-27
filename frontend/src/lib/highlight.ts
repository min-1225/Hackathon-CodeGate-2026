import type { EntityType, TokenMapping } from "../types";

export interface Segment {
  text: string;
  type: EntityType | null;
}


function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 원문에서 매핑된 원본 값들(회사명·인명·금액 등)을 하이라이트 구간으로 분리한다. */
export function buildOriginalSegments(original: string, mappings: TokenMapping[]): Segment[] {
  if (mappings.length === 0) return [{ text: original, type: null }];

  const uniqueValues = [...new Set(mappings.map((m) => m.original))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(uniqueValues.map(escapeRegExp).join("|"), "g");
  const typeByOriginal = new Map(mappings.map((m) => [m.original, m.type]));

  const segments: Segment[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(original)) !== null) {
    if (m.index > cursor) segments.push({ text: original.slice(cursor, m.index), type: null });
    segments.push({ text: m[0], type: typeByOriginal.get(m[0]) ?? null });
    cursor = m.index + m[0].length;
  }
  if (cursor < original.length) segments.push({ text: original.slice(cursor), type: null });
  return segments;
}

/** 토큰화된 텍스트에서 [ORG_1]류 토큰을 하이라이트 구간으로 분리한다. */
export function buildTokenSegments(tokenizedText: string): Segment[] {
  const pattern = /\[(ORG|PERSON|AMOUNT)_\d+\]/g;
  const segments: Segment[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(tokenizedText)) !== null) {
    if (m.index > cursor) segments.push({ text: tokenizedText.slice(cursor, m.index), type: null });
    segments.push({ text: m[0], type: m[1] as EntityType });
    cursor = m.index + m[0].length;
  }
  if (cursor < tokenizedText.length) segments.push({ text: tokenizedText.slice(cursor), type: null });
  return segments;
}
