import type { MeetingProcessResult } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const PROCESS_MEETING_URL = `${API_BASE_URL}/api/process-meeting`;

export interface PiiFinding {
  type: string;
  preview: string;
  confidence: number;
}

/** 백엔드 /api/process-meeting 호출 실패 시 던져지는 에러. code/findings로 상태코드별 원인을 구분할 수 있다. */
export class BackendApiError extends Error {
  code?: string;
  findings?: PiiFinding[];

  constructor(message: string, code?: string, findings?: PiiFinding[]) {
    super(message);
    this.name = "BackendApiError";
    this.code = code;
    this.findings = findings;
  }
}

interface ErrorResponseBody {
  error?: string;
  code?: string;
  findings?: PiiFinding[];
}

/**
 * 토큰화된 회의 전문을 VeilNote 백엔드로 보내 요약·결정사항·액션아이템을 받는다.
 * 원문/매핑 테이블은 절대 함께 보내지 않는다 — transcriptTokenized만 전송한다.
 */
export async function processMeeting(
  transcriptTokenized: string,
  participantTokens: string[] = [],
  meetingTitle?: string,
): Promise<MeetingProcessResult> {
  let response: Response;
  try {
    response = await fetch(PROCESS_MEETING_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptTokenized, participantTokens, meetingTitle }),
    });
  } catch {
    throw new BackendApiError(
      "백엔드 서버에 연결하지 못했습니다. VeilNote 백엔드(http://localhost:3000)가 실행 중인지 확인해주세요.",
    );
  }

  if (!response.ok) {
    let body: ErrorResponseBody = {};
    try {
      body = await response.json();
    } catch {
      // 응답 본문을 파싱할 수 없는 경우 무시하고 상태 코드 기반 메시지를 사용
    }

    if (response.status === 400) {
      throw new BackendApiError(body.error ?? "요청 형식이 올바르지 않습니다.", body.code);
    }
    if (response.status === 422) {
      throw new BackendApiError(
        body.error ?? "토큰화되지 않은 개인정보가 남아 있어 전송이 차단되었습니다. 원문에서 해당 항목을 다시 확인해주세요.",
        body.code,
        body.findings,
      );
    }
    if (response.status === 502) {
      throw new BackendApiError(
        body.error ?? "AI 서버 호출에 실패했습니다. 잠시 후 다시 시도해주세요.",
        body.code,
      );
    }
    throw new BackendApiError(`요청이 실패했습니다 (${response.status}). ${body.error ?? ""}`.trim(), body.code);
  }

  const data = await response.json();
  if (!data || typeof data.summary !== "string" || !Array.isArray(data.tasks)) {
    throw new BackendApiError("서버 응답 형식이 올바르지 않습니다.");
  }

  return data as MeetingProcessResult;
}
