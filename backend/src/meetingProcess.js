// VeilNote — MEETING_PROCESS 계약
//
// 회의 1건 처리에 LLM 호출 1회. 토큰화된 회의 전문을 받아
// 요약 · 결정사항 · 액션아이템을 "하나의 JSON"으로 생성한다.
//
// 액션아이템은 그대로 할일 대시보드(taskStore)의 항목이 된다 —
// 별도 AI 호출 없이 이 스키마 하나로 "회의 → 실제 업무"가 이어진다.
//
// 보안 원칙:
// - 입력은 이미 비식별화된 토큰 텍스트만. 원문/매핑테이블은 취급하지 않는다.
// - 날짜는 절대값이 아니라 상대일수(dueOffsetDays)로만 받는다 (요일 계산/연도 환각 방지).
//   절대 날짜 계산(meeting.startedAt + offset)은 브라우저가 한다.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.VEILNOTE_MODEL || 'claude-opus-4-8';
const EFFORT = process.env.VEILNOTE_EFFORT || 'medium';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. .env를 확인하세요.');
  }
  if (!client) client = new Anthropic();
  return client;
}

export const MEETING_SYSTEM_PROMPT = `당신은 VeilNote의 회의록 처리 에이전트입니다. 회의 1건을 받아 팀의 실행 가능한 업무로 변환합니다.

[입력 규칙 — 비식별화]
- 회의 전문은 이미 비식별화되어 있습니다. 회사명·고객사·인명·금액 등은 [ORG_1], [PERSON_2], [MONEY_1] 같은 대괄호 토큰으로 치환돼 있습니다.
- 토큰이 가리키는 실제 값은 당신이 알 수 없고, 알 필요도 없습니다. 추측하지 마십시오.
- 입력에 등장한 토큰은 출력에서도 반드시 대괄호 포함 문자 그대로 사용하십시오. 새 토큰을 지어내지 마십시오.

[전사 오류 교정 — 요약보다 먼저]
- 회의 전문은 온디바이스 음성인식(Whisper) 결과라 오탈자·띄어쓰기 오류·동음이의 오인식이 섞여 있습니다.
  (예: "일정 공유" → "일종 공유", "배포" → "배표", "API 스펙" → "에이피아이 스팩")
- 요약·액션아이템을 뽑기 전에, 먼저 문맥에 맞게 자연스럽게 교정한 문장을 머릿속으로 확정하고
  그 교정본을 근거로 나머지 결과물을 작성하십시오.
- ⚠️ 대괄호 토큰([ORG_1], [PERSON_2] 등)은 교정 대상이 아닙니다. 오탈자처럼 보여도 절대 바꾸지 마십시오.
  토큰을 손대면 사용자 기기의 매핑 테이블과 어긋나 복원이 깨집니다.
- 근거 없는 내용 보충은 교정이 아닙니다. 발화되지 않은 정보를 지어내지 마십시오.
  무슨 말인지 끝내 알 수 없는 구간은 교정하지 말고 그대로 두십시오.
- 실제로 고친 것만 corrections에 보고하십시오. 고친 게 없으면 빈 배열입니다.

[액션아이템 — 이 결과가 그대로 팀의 할일 목록이 됩니다]
- 회의에서 "누군가 해야 한다"고 합의되거나 지시된 후속 업무만 뽑으십시오. 단순 논의·의견은 액션아이템이 아닙니다.
- 각 항목의 text는 체크박스 옆에 그대로 표시됩니다. "무엇을 하면 완료인지"가 드러나는 한 문장으로 쓰십시오.

[담당자(ownerToken) 배정 규칙]
- participantTokens 목록에 없는 인물은 절대 배정하지 마십시오 (환각 방지).
- 발언 맥락에서 "제가 하겠다"류의 자기 선언이 있으면 그 사람을 최우선 근거로 채택하십시오.
- 근거가 불충분하면 ownerToken을 null로 두십시오. 억지 배정보다 미배정이 낫습니다.
- ownerReason(배정 근거)은 반드시 채우십시오. 근거가 화면에 표시되어 "AI 자동 배정"의 거부감을 줄입니다.

[우선순위(priority) 판정 기준 — 엄격히 적용]
- P1: 다른 업무를 블로킹하거나, 회의에서 명시적 기한이 언급됨.
- P2: 이번 주/스프린트 내 처리 필요로 합의됨.
- P3: 논의는 됐으나 시점이 정해지지 않음.
- priorityReason(근거)을 반드시 채우십시오.

[마감일 규칙 — 절대 날짜 금지]
- 절대 날짜(예: 2026-07-24)를 생성하지 마십시오. 요일 계산 오류와 연도 환각의 원인입니다.
- 대신 회의 시점 기준 상대일수 dueOffsetDays(정수)로만 답하십시오. 예: "이번 주 금요일까지"→회의가 월요일이면 4.
- 기한 근거가 전혀 없으면 dueOffsetDays를 null로 두십시오.

[개인 성과 STAR 문장 — personalStar]
- 회의록에서 화자 본인의 발언 중 "본인이 직접 기여·수행한 내용"으로 읽히는 부분을 근거로,
  개인 성과 기록에 바로 쓸 수 있도록 1인칭 관점의 STAR(상황·과제·행동·결과) 문장을 작성하십시오.
- situation(상황), task(과제), action(행동), result(결과) 각각 1~3문장. 근거 없는 내용을 지어내지 마십시오.
- 회의 내용만으로 특정 항목의 근거가 부족하면, 있는 그대로("이 회의에서는 결과가 아직 확인되지 않음" 등) 담백하게 쓰고 과장하지 마십시오.
- 입력에 등장한 대괄호 토큰은 다른 필드와 동일하게 그대로 유지하십시오.

결과는 지정된 JSON 스키마를 정확히 따르며, 그 외 텍스트는 출력하지 마십시오.`;

export function buildMeetingUserPrompt({
  transcriptTokenized,
  participantTokens = [],
  meetingTitle,
}) {
  const title = meetingTitle ? `회의 제목: ${meetingTitle}\n` : '';
  const participants =
    participantTokens.length > 0
      ? participantTokens.join(', ')
      : '(명시되지 않음 — 발언자 토큰에서 유추)';

  return `${title}참석자 토큰: ${participants}

--- 회의 전문 (토큰화됨) ---
${transcriptTokenized}
--- 끝 ---`;
}

// 구조화 출력(structured outputs) JSON 스키마.
// actionItems의 각 필드는 taskStore의 할일 레코드 필드와 1:1로 대응한다.
export const MEETING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    corrections: {
      type: 'array',
      description:
        '음성인식 오류를 문맥으로 교정한 내역. 실제 교정한 것만. 없으면 빈 배열.',
      items: {
        type: 'object',
        properties: {
          before: { type: 'string', description: '전사된 원래 표현.' },
          after: { type: 'string', description: '교정한 표현.' },
        },
        required: ['before', 'after'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'string',
      description:
        '회의 전체를 2~4문장으로 요약. 교정본 기준. 토큰은 그대로 유지.',
    },
    decisions: {
      type: 'array',
      description: '회의에서 확정된 결정 사항 목록.',
      items: { type: 'string' },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '수행할 업무 (토큰 유지).' },
          ownerToken: {
            type: ['string', 'null'],
            description: 'participantTokens 중 담당자 토큰. 특정 불가 시 null.',
          },
          ownerReason: {
            type: 'string',
            description: '이 담당자를 고른 근거 (배정이 null이어도 사유 기재).',
          },
          priority: {
            type: 'string',
            enum: ['P1', 'P2', 'P3'],
            description: 'P1/P2/P3. 판정 기준은 시스템 프롬프트 참조.',
          },
          priorityReason: { type: 'string', description: '우선순위 근거.' },
          dueOffsetDays: {
            type: ['integer', 'null'],
            description: '회의 시점 기준 상대일수. 기한 근거 없으면 null.',
          },
          dueReason: {
            type: 'string',
            description: '마감일 근거(회의 발언). 없으면 빈 문자열.',
          },
        },
        required: [
          'text',
          'ownerToken',
          'ownerReason',
          'priority',
          'priorityReason',
          'dueOffsetDays',
          'dueReason',
        ],
        additionalProperties: false,
      },
    },
    personalStar: {
      type: 'object',
      description:
        '화자 본인의 기여로 읽히는 내용을 1인칭 개인 성과 기록용 STAR(상황·과제·행동·결과) 문장으로 정리.',
      properties: {
        situation: { type: 'string', description: '상황(Situation). 어떤 배경·맥락이었는지.' },
        task: { type: 'string', description: '과제(Task). 본인이 맡았던 과제·목표.' },
        action: { type: 'string', description: '행동(Action). 본인이 실제로 취한 행동.' },
        result: { type: 'string', description: '결과(Result). 그 행동으로 만든 결과·성과.' },
      },
      required: ['situation', 'task', 'action', 'result'],
      additionalProperties: false,
    },
  },
  required: ['corrections', 'summary', 'decisions', 'actionItems', 'personalStar'],
  additionalProperties: false,
};

/**
 * MEETING_PROCESS — 회의 1건 → 전사 교정 + 요약 + 결정 + 액션아이템.
 * @param {{ transcriptTokenized: string, participantTokens?: string[], meetingTitle?: string }} input
 * @returns {Promise<{corrections: object[], summary: string, decisions: string[],
 *                    actionItems: object[], personalStar: {situation: string, task: string,
 *                    action: string, result: string}, _meta: object}>}
 */
export async function processMeeting(input) {
  const { transcriptTokenized } = input;
  if (!transcriptTokenized || !transcriptTokenized.trim()) {
    throw new Error('transcriptTokenized가 비어 있습니다.');
  }

  const anthropic = getClient();

  const call = () =>
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: MEETING_SYSTEM_PROMPT,
      output_config: {
        effort: EFFORT,
        format: { type: 'json_schema', schema: MEETING_OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: buildMeetingUserPrompt(input) }],
    });

  // JSON 파싱 실패 시 1회 재시도.
  let response = await call();
  if (response.stop_reason === 'refusal') {
    const cat = response.stop_details?.category ?? 'unknown';
    throw new Error(`모델이 요청을 거절했습니다 (category: ${cat}).`);
  }

  let parsed = tryParse(response);
  if (!parsed) {
    response = await call();
    parsed = tryParse(response);
    if (!parsed) throw new Error('모델 응답 JSON 파싱에 2회 실패했습니다.');
  }

  return {
    ...parsed,
    corrections: dropTokenTouchingCorrections(parsed.corrections),
    _meta: {
      model: response.model,
      stopReason: response.stop_reason,
      usage: response.usage,
    },
  };
}

const TOKEN_RE = /\[[A-Z_]+_\d+\]/;

/**
 * 대괄호 토큰을 건드린 교정 항목을 버린다.
 *
 * 교정은 어디까지나 "전사 오류"를 대상으로 한다. 모델이 토큰을 오탈자로 오해해
 * 고치면 사용자 기기의 매핑 테이블과 어긋나 복원이 깨지므로, 프롬프트 지시와 별개로
 * 서버에서 한 번 더 막는다. (버리는 것은 교정 "보고"일 뿐이고, 토큰 자체의 보존은
 * 요약·액션아이템 텍스트에서 그대로 유지된다.)
 */
export function dropTokenTouchingCorrections(corrections) {
  if (!Array.isArray(corrections)) return [];
  const kept = corrections.filter(
    (c) => !TOKEN_RE.test(c.before ?? '') && !TOKEN_RE.test(c.after ?? '')
  );
  if (kept.length !== corrections.length) {
    console.warn(
      `교정 항목 ${corrections.length - kept.length}건이 토큰을 건드려 폐기됨`
    );
  }
  return kept;
}

function tryParse(response) {
  const textBlock = response.content?.find((b) => b.type === 'text');
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
}

export const meetingProcessConfig = { MODEL, EFFORT };
