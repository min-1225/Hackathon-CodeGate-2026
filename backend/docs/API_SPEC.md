# VeilNote 백엔드 API 명세서

- Base URL (로컬): `http://localhost:3000`
- 포맷: 모든 요청/응답은 `application/json` (Content-Type 헤더 필요)
- 인증: 없음 (프로토타입). API 키는 서버에만 존재하며 프론트에 노출되지 않음.
- CORS: 모든 오리진 허용 (프론트가 별도 dev 서버에서 붙는 것을 전제)
- 공통 정책: 서버는 회의 원문·매핑 테이블을 받지 않고, 요청/응답 본문을 로그에도 남기지 않음.

## 목차
1. [GET /health](#1-get-health)
2. [POST /api/process-meeting](#2-post-apiprocess-meeting-메인-엔드포인트) — 메인
3. [할일 대시보드 API](#3-할일-대시보드-api)
4. [데모 전용 엔드포인트](#4-데모-전용-엔드포인트)
5. [공통 타입 정의](#5-공통-타입-정의)
6. [에러 처리 가이드](#6-에러-처리-가이드)

---

## 1. `GET /health`

### Response `200`
```json
{
  "ok": true,
  "service": "veilnote-backend",
  "model": "claude-opus-4-8",
  "effort": "medium",
  "apiKeyConfigured": true
}
```

---

## 2. `POST /api/process-meeting` (메인 엔드포인트)

브라우저에서 토큰화(비식별화)를 마친 회의 전문을 받아 **LLM 1회 호출**로 요약·결정사항·액션아이템을 생성한다.
생성된 액션아이템은 **곧바로 할일 대시보드에 적재**되어 `tasks` 배열로 반환된다 (추가 LLM 호출 없음).

> ⚠️ 이 엔드포인트는 **토큰화된 텍스트만** 받는다. 원문이나 매핑 테이블(토큰↔원문)을 절대 함께 보내면 안 된다 — 매핑 테이블은 기기(브라우저)에만 저장되어야 함.

### Request Body

```json
{
  "transcriptTokenized": "[PERSON_1]: [CLIENT_1]과의 계약 건 [MONEY_1] 규모로 진행하기로 했습니다.",
  "participantTokens": ["[PERSON_1]", "[PERSON_2]"],
  "meetingTitle": "3분기 영업 회의"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| transcriptTokenized | string | ✅ | 토큰화된 회의 전문. 대괄호 토큰 형태를 그대로 포함해야 함. |
| participantTokens | string[] | ❌ | 참석자 사람 토큰 화이트리스트. **담당자 환각 방지용** — 이 목록 밖의 인물은 배정되지 않음. |
| meetingTitle | string | ❌ | 회의 제목 (요약 컨텍스트 + 할일의 출처 표시용). |

### Response `200`

```json
{
  "corrections": [
    { "before": "상대가 수영했습니다", "after": "상대가 수용했습니다" }
  ],
  "summary": "회의 전체 요약 2~4문장 (토큰 유지)",
  "decisions": ["결정 사항 1", "결정 사항 2"],
  "tasks": [
    {
      "id": "task_m5k2p1",
      "text": "[CLIENT_1]에 최종 견적서 발송",
      "ownerToken": "[PERSON_2]",
      "ownerReason": "본인이 발송을 맡겠다고 발언",
      "priority": "P1",
      "priorityReason": "회의에서 명시적 기한이 언급됨",
      "dueOffsetDays": 11,
      "dueReason": "\"다음 주 금요일까지\" 발언",
      "status": "open",
      "source": "meeting",
      "meetingId": "meeting_m5k2p0",
      "meetingTitle": "3분기 영업 회의",
      "createdAt": "2026-07-21T04:00:00.000Z",
      "completedAt": null
    }
  ],
  "_meta": { "model": "claude-opus-4-8", "stopReason": "end_turn", "usage": {} }
}
```

**주의:** 응답의 모든 문자열은 **토큰 상태 그대로** 반환된다. 원문 복원은 백엔드가 하지 않으며, **프론트가 자신이 보관 중인 매핑 테이블로 복원**해야 한다 (`src/shared/tokenizer.js`의 `restore` 를 `/shared/tokenizer.js` 로 직접 로드해 쓸 수 있음).

**전사 오류 교정 (`corrections`):** 입력이 온디바이스 음성인식 결과라는 전제로, LLM이 요약을 뽑기 **전에** 문맥으로 오인식을 교정하고 그 교정본을 근거로 나머지 결과물을 만든다. **별도 LLM 호출이 아니라 같은 호출 안에서 일어나므로 추가 비용이 없다.**

- `corrections`는 실제로 고친 것만 담기며, 고친 게 없으면 `[]`.
- 대괄호 토큰은 교정 대상이 아니다. 프롬프트로 금지하고, **서버가 한 번 더 검사해** 토큰을 건드린 교정 항목은 응답에서 폐기한다 (매핑 테이블과 어긋나 복원이 깨지는 것을 방지).
- 교정은 이미 토큰화된 텍스트 위에서만 일어난다 — 오디오와 원문은 계속 기기에만 있다.
- 프론트에서는 "음성인식 n곳 자동 교정됨" 같은 배지로 노출하면 좋다. 원문 대조가 필요하면 `before`/`after`를 그대로 보여줄 것.

**마감일 처리:** 서버는 절대 날짜를 만들지 않는다 (요일 계산 오류·연도 환각 방지). `dueOffsetDays`는 회의 시점 기준 **상대일수**이며, 실제 날짜는 프론트가 `회의시작시각 + dueOffsetDays` 로 계산한다. 기한 근거가 없으면 `null`.

### Response `400`
```json
{ "error": "transcriptTokenized(문자열)가 필요합니다." }
```

### Response `422` (서버측 유출 게이트 차단) ⚠️ 중요

`transcriptTokenized`에 토큰화되지 않은 원문 PII(이메일/전화번호/주민등록번호/카드번호)가 남아있으면, **LLM을 호출하지 않고** 즉시 차단한다.

```json
{
  "error": "전송 차단: 토큰화되지 않은 개인정보가 남아 있습니다.",
  "code": "RESIDUAL_PII_BLOCKED",
  "findings": [{ "type": "EMAIL", "preview": "h***@g***.com", "confidence": 0.98 }]
}
```

`findings[].type`은 `EMAIL` \| `PHONE` \| `RRN` \| `CARD`. `preview`는 마스킹된 미리보기라 원문이 그대로 노출되지 않는다.

**프론트 대응 가이드:** "토큰화가 누락된 부분이 있습니다" 경고 UI를 띄우고, 재전송 전에 사용자가 원문 화면에서 해당 항목을 다시 확인/마스킹하도록 유도할 것.

### Response `502` (LLM 호출 실패)
```json
{ "error": "ANTHROPIC_API_KEY가 설정되지 않았습니다. / 모델이 요청을 거절했습니다 등" }
```

---

## 3. 할일 대시보드 API

회의에서 뽑힌 액션아이템을 체크박스로 완료 처리하는 대시보드용 API. **LLM을 호출하지 않는다.**

> 저장소는 서버 프로세스 메모리(인메모리)다. 서버를 재시작하면 초기화된다 — 영속화가 필요하면 프론트가 IndexedDB에 함께 보관할 것.

### `GET /api/tasks` — 목록

Query 파라미터 (모두 선택):

| 파라미터 | 값 | 설명 |
|---|---|---|
| status | `open` \| `done` | 상태 필터. 없으면 전체 |
| ownerToken | `[PERSON_1]` | 담당자 필터 |
| meetingId | `meeting_...` | 특정 회의에서 나온 할일만 |

정렬은 **미완료 먼저 → P1·P2·P3 → 생성순**이라 그대로 렌더링하면 된다.

```json
{
  "tasks": [ /* Task[] */ ],
  "stats": {
    "total": 5, "open": 3, "done": 2,
    "byPriority": { "P1": 1, "P2": 2, "P3": 0 },
    "unassigned": 1
  }
}
```
`stats`는 미완료 기준 집계로, 대시보드 상단 카운터에 그대로 쓸 수 있다 (`total`만 전체 기준).

### `GET /api/tasks/:id` — 단건
`200` → `{ "task": Task }` / `404` → `{ "error": "할일을 찾을 수 없습니다." }`

### `PATCH /api/tasks/:id` — 체크박스 토글 및 수동 수정

```json
{ "status": "done" }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| status | `"open"` \| `"done"` | **체크박스의 주 용도.** `done`이면 `completedAt`이 채워지고, `open`으로 되돌리면 `null`이 된다 |
| text | string | 할일 내용 수정 (빈 문자열 불가) |
| ownerToken | string \| null | 담당자 수동 재배정. AI 배정을 사람이 덮어쓸 수 있다. 변경 시 `ownerReason`이 `"사용자가 직접 배정"`으로 바뀜 |
| priority | `"P1"` \| `"P2"` \| `"P3"` | 우선순위 수동 조정. `priorityReason`이 `"사용자가 직접 조정"`으로 바뀜 |

응답 `200`: `{ "task": Task, "stats": {...} }` — 갱신된 항목과 재계산된 집계를 함께 주므로 상단 카운터를 따로 다시 부를 필요가 없다.
`400`: 변경할 필드가 없거나 허용되지 않는 값. `404`: 없는 id.

### `DELETE /api/tasks/:id`
`200` → `{ "ok": true, "stats": {...} }` / `404` → `{ "error": "할일을 찾을 수 없습니다." }`

---

## 4. 데모 전용 엔드포인트

> ⚠️ 실서비스에서는 프론트(브라우저)가 직접 수행한다. 서버 재현본은 테스트/디버깅용.

| 엔드포인트 | 요청 | 응답 |
|---|---|---|
| `POST /api/demo/detect` | `{ rawText, dictionary? }` | `{ detections: Detection[] }` (규칙+사전만, NER 미포함) |
| `POST /api/demo/tokenize` | `{ rawText, dictionary? }` | `{ tokenized, mapping }` — mapping은 **기기 로컬에만 보관** |
| `POST /api/demo/restore` | `{ data, mapping }` | `{ restored }` — 문자열/배열/객체를 재귀 복원 |

`dictionary`는 `{ "ORG": ["테크컴퍼니"], "PERSON": ["소지윤"] }` 형태.
탐지 가능 타입(정규식): `RRN`, `CARD`, `EMAIL`, `PHONE`, `MONEY`, `DATE`. 사전으로 임의 타입 추가 가능.

또한 `GET /shared/tokenizer.js`, `/shared/detector.js`, `/shared/leakGuard.js` 로 **브라우저·서버 공용 순수 ESM 모듈**을 그대로 로드할 수 있다.

---

## 5. 공통 타입 정의

### Task
```ts
{
  id: string;
  text: string;                      // 토큰 상태
  ownerToken: string | null;         // 담당자 토큰, 미배정이면 null
  ownerReason: string;               // 배정 근거 (화면에 표시 → AI 자동 배정 거부감 완화)
  priority: "P1" | "P2" | "P3";
  priorityReason: string;
  dueOffsetDays: number | null;      // 회의 시점 기준 상대일수
  dueReason: string;
  status: "open" | "done";
  source: "meeting";
  meetingId: string;
  meetingTitle: string;
  createdAt: string;                 // ISO 8601
  completedAt: string | null;
}
```

### Detection
```ts
{
  type: string;        // "EMAIL" | "PHONE" | "RRN" | "CARD" | "MONEY" | "DATE" | (dictionary/NER 지정 타입)
  value: string;
  start: number;
  end: number;
  source: "regex" | "dictionary" | "ner";
  confidence: number;  // 0~1
}
```

### ErrorResponse
```ts
{
  error: string;
  code?: string;        // 예: "RESIDUAL_PII_BLOCKED"
  findings?: Array<{ type: string; preview: string; confidence: number }>;
}
```

---

## 6. 에러 처리 가이드

| 상태 코드 | 상황 | 프론트 대응 |
|---|---|---|
| 400 | 필수 필드 누락 / 허용되지 않는 값 | 입력 유효성 재확인 |
| 404 | 없는 할일 id | 목록 갱신 후 재시도 |
| 422 | 잔여 PII 탐지 (`RESIDUAL_PII_BLOCKED`) | "토큰화 누락" 경고 UI 표시, 재확인 유도 |
| 502 | LLM 호출 실패 (키 미설정/모델 거절 등) | 일시적 오류 안내, 재시도 버튼 제공 |

## 참고 — 전체 데이터 흐름

1. 프론트: 원문 입력 → 규칙+NER로 PII 자동 탐지 (브라우저 내 처리)
2. 프론트: 사용자가 탐지 결과 확인/수정(HITL) → 토큰화 → **매핑 테이블은 브라우저(IndexedDB)에만 저장**
3. 프론트: 전송 직전 자체 유출 검사(매핑의 원본 값이 남아있는지 대조) 통과 확인
4. 프론트 → 백엔드: `POST /api/process-meeting` 에 `transcriptTokenized`만 전송
5. 백엔드: 잔여 PII 게이트 통과 시에만 LLM 호출 → 요약·결정·액션아이템 → 액션아이템을 할일로 적재
6. 프론트: 응답을 로컬 매핑 테이블로 복원해 **회의 요약 화면 + 할일 대시보드**에 표시
7. 사용자가 체크박스를 누르면 `PATCH /api/tasks/:id { status }` — "회의만 하고 끝"이 아니라 실제 업무로 이어진다
