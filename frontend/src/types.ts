export type EntityType = "ORG" | "PERSON" | "AMOUNT";

export interface TokenMapping {
  token: string;
  type: EntityType;
  original: string;
}

export interface TokenizeResult {
  tokenizedText: string;
  mappings: TokenMapping[];
}

/** 자동 탐지된 민감정보 후보 1건. 토큰화 전, 사람이 검토해서 가릴지/놔둘지 확정한다(HITL). */
export interface DetectedEntity {
  id: string;
  start: number;
  end: number;
  text: string;
  type: EntityType;
  /** 사용자가 직접 추가한 항목인지, 자동 탐지된 항목인지. */
  source: "auto" | "manual";
  /** 가릴지 여부. 사용자가 토글해서 확정한다. */
  included: boolean;
}

export type Priority = "P1" | "P2" | "P3";

export type TaskStatus = "open" | "done";

/** 백엔드 /api/process-meeting이 생성하고, 할일 대시보드가 그대로 다루는 액션아이템. */
export interface Task {
  id: string;
  text: string;
  ownerToken: string | null;
  ownerReason: string;
  priority: Priority;
  priorityReason: string;
  dueOffsetDays: number | null;
  dueReason: string;
  status: TaskStatus;
  source: "meeting";
  meetingId: string;
  meetingTitle: string;
  createdAt: string;
  completedAt: string | null;
}

export interface Correction {
  before: string;
  after: string;
}

/** 화자 본인의 기여를 1인칭 STAR(상황·과제·행동·결과) 문장으로 정리한 개인 성과 기록. */
export interface PersonalStar {
  situation: string;
  task: string;
  action: string;
  result: string;
}

/** POST /api/process-meeting의 응답. 모든 문자열 필드는 토큰 상태 그대로 온다. */
export interface MeetingProcessResult {
  corrections: Correction[];
  summary: string;
  decisions: string[];
  tasks: Task[];
  personalStar: PersonalStar;
  _meta?: {
    model?: string;
    stopReason?: string;
    usage?: unknown;
  };
}

export type Screen = "home" | "input" | "review" | "processing" | "result" | "dashboard";

/** 회의 1건의 처리 결과를 브라우저(localStorage)에 누적 저장하기 위한 레코드. */
export interface MeetingRecord {
  id: string;
  createdAt: string;
  summary: string;
  decisions: string[];
  tasks: Task[];
  /** 이 필드가 추가되기 전에 저장된 기존 기록에는 없을 수 있다(optional). */
  personalStar?: PersonalStar;
}
