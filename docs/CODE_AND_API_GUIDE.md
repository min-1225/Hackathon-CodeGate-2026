# VeilNote 코드 및 API 해설

## 1. 분석 기준

이 문서는 팀 원본 저장소 [`TRACEGATE/hackathon_2026`](https://github.com/TRACEGATE/hackathon_2026)의 `main` 브랜치 `7619bc1`에 포함된 실제 코드를 기준으로 작성했습니다.

```text
backend/   Node.js + Express + Anthropic SDK
frontend/  React + TypeScript + Vite + 브라우저 온디바이스 Whisper
```

Java 백엔드는 원본 저장소에 없습니다. 현재 구현은 JavaScript ESM 기반 Express 서버입니다.

## 2. 전체 실행 흐름

```text
마이크 입력
  → AudioWorklet에서 PCM 프레임 수집
  → Web Worker에서 Whisper 실행
  → 프런트엔드 규칙·사전 기반 민감정보 탐지
  → 사용자가 탐지 결과 포함·제외·직접 추가
  → 토큰화 및 매핑 테이블 로컬 보관
  → POST /api/process-meeting
  → 백엔드 잔존 PII 검사
  → Anthropic Claude 구조화 출력
  → 액션아이템을 인메모리 할일로 적재
  → 프런트엔드에서 중첩 응답을 로컬 매핑으로 복원
```

## 3. Backend

### 3-1. `backend/src/server.js`

Express 애플리케이션 진입점입니다.

- CORS 헤더와 JSON 본문 제한을 적용합니다.
- `/shared` 경로로 순수 ESM 공용 모듈을 제공합니다.
- 요청 본문을 제외한 method/path만 기록합니다.
- 잔존 PII를 발견하면 Claude 호출 전에 `422`로 종료합니다.
- LLM의 액션아이템을 `taskStore`에 적재합니다.

### 3-2. `backend/src/meetingProcess.js`

Claude 호출과 구조화 출력 계약을 담당합니다.

- `MEETING_SYSTEM_PROMPT`: 토큰 보존, 전사 교정, 담당자·우선순위·마감일 규칙을 정의합니다.
- `MEETING_OUTPUT_SCHEMA`: 요약, 결정사항, 액션아이템, STAR 결과의 JSON Schema입니다.
- Claude 응답 JSON 파싱 실패 시 한 번만 재시도합니다.
- 대괄호 토큰을 변경한 교정 결과는 폐기합니다.

### 3-3. `backend/src/taskStore.js`

추가 데이터베이스 없이 해커톤 데모를 실행하기 위한 인메모리 저장소입니다.

- 액션아이템을 할일 레코드로 변환합니다.
- 상태, 담당자, 회의 ID로 필터링합니다.
- 우선순위와 생성 시각을 기준으로 정렬합니다.
- 상태·내용·담당자·우선순위를 검증해 수정합니다.
- 전체·미완료·완료·P1 개수를 집계합니다.

### 3-4. `backend/src/shared/`

Node 의존성이 없는 프로젝트 공용 함수입니다.

- `detector.js`: 이메일, 전화번호, 주민등록번호, 카드번호, 금액, 날짜 등의 정규식 탐지
- `tokenizer.js`: 정규식·사전·NER 결과 병합, 겹침 해소, 토큰화, 깊은 복원
- `leakGuard.js`: 원문 잔존 검사와 서버측 차단 대상 요약

## 4. Frontend

### 4-1. `frontend/src/App.tsx`

홈 → 입력 → 토큰 검토 → 처리 → 결과 → 대시보드 화면 전환을 관리하는 최상위 컴포넌트입니다.

### 4-2. `frontend/src/lib/tokenizer.ts`

실제 프런트엔드 토큰화 구현입니다.

- 회사·기관 사전과 접미사 패턴
- 한국 성씨와 직함·조사 패턴
- 금액 패턴
- 겹침 방지
- 사용자의 민감정보 직접 추가
- 동일 원문을 같은 토큰으로 치환
- 문자열·배열·객체 전체를 재귀 복원

### 4-3. `frontend/src/lib/claudeApi.ts`

이름과 달리 브라우저에서 Claude를 직접 호출하지 않습니다. `VITE_API_BASE_URL`을 기준으로 Express 백엔드의 `/api/process-meeting`만 호출합니다.

### 4-4. `frontend/public/mic.js`

마이크, VAD, 리샘플링, Whisper 작업 큐를 오케스트레이션합니다.

### 4-5. `frontend/public/pcm-worklet.js`

오디오 렌더 스레드의 PCM 데이터를 메인 스레드에 전달하는 `AudioWorkletProcessor`입니다.

### 4-6. `frontend/public/whisper-worker.js`

Transformers.js의 Whisper 파이프라인을 별도 Worker에서 실행합니다.

- WebGPU `fp32` 우선
- 실패 시 WASM `q8` 폴백
- 반복 n-gram 억제
- 반복 문구 축약
- 뉴스·구독 문구 기반 환각 필터

## 5. 프로젝트에서 직접 만든 코드

아래 함수·클래스·컴포넌트는 라이브러리 메서드가 아니라 이 프로젝트에서 직접 작성한 코드입니다.

### 5-1. Backend 사용자 정의 함수

| 파일 | 함수 | 역할 |
| --- | --- | --- |
| `meetingProcess.js` | `getClient()` | API 키 확인 후 Anthropic 클라이언트 지연 생성 |
|  | `buildMeetingUserPrompt(input)` | 회의 제목·참석자 토큰·회의 전문을 사용자 프롬프트로 구성 |
|  | `processMeeting(input)` | Claude 호출, 거절 처리, JSON 재시도, 결과 정리 |
|  | `dropTokenTouchingCorrections(corrections)` | 토큰을 변경한 전사 교정 결과 제거 |
|  | `tryParse(response)` | Anthropic 응답의 text block을 JSON으로 파싱 |
| `taskStore.js` | `nextId(prefix)` | 데모용 순차 ID 생성 |
|  | `addTasksFromActionItems(items, meta)` | LLM 액션아이템을 할일 레코드로 변환 |
|  | `listTasks(filter)` | 상태·담당자·회의 필터와 정렬 |
|  | `getTask(id)` | 단건 조회 |
|  | `updateTask(id, patch)` | 변경값 검증과 할일 수정 |
|  | `deleteTask(id)` | 단건 삭제 |
|  | `taskStats()` | 할일 집계 |
|  | `resetTasks()` | 데모 상태 초기화 |
| `detector.js` | `detectByRegex(text)` | `REGEX_RULES`로 민감정보 후보 탐지 |
|  | `resolveOverlaps(detections)` | 겹치는 탐지 결과 우선순위 처리 |
|  | `maskValue(value)` | 오류 응답용 마스킹 미리보기 생성 |
| `tokenizer.js` | `detectByDictionary(text, dictionary)` | 사용자 사전 기반 탐지 |
|  | `nerToDetections(text, entities)` | 외부 NER 결과를 내부 탐지 형식으로 변환 |
|  | `buildDetections(text, options)` | 정규식·사전·NER 결과 병합 |
|  | `applyTokenization(text, detections)` | 확정 구간을 토큰과 매핑으로 변환 |
|  | `tokenize(rawText, dictionary, options)` | 전체 탐지·토큰화 편의 함수 |
|  | `restore(value, mapping)` | 문자열·배열·객체의 토큰 재귀 복원 |
| `leakGuard.js` | `checkResidualOriginals(text, mapping)` | 매핑의 원문이 토큰 텍스트에 남았는지 확인 |
|  | `scanResidualPII(text, options)` | 서버에서 차단할 잔존 개인정보 탐지 |
|  | `summarizeFindings(findings)` | 원문 대신 유형·마스킹 미리보기만 반환 |

`server.js`의 각 `app.get/post/patch/delete` 콜백도 프로젝트가 작성한 라우트 처리 함수입니다.

### 5-2. Frontend 사용자 정의 함수

| 파일 | 함수·클래스 | 역할 |
| --- | --- | --- |
| `lib/claudeApi.ts` | `BackendApiError` | 상태 코드·에러 코드·탐지 결과를 보관하는 사용자 정의 오류 |
|  | `processMeeting(request)` | 백엔드 요청과 응답 검증 |
| `lib/tokenizer.ts` | `trimTrailingParticles` | 회사명 뒤 조사 제거 |
|  | `escapeRegExp` | 사전 항목을 정규식에 안전하게 사용하도록 이스케이프 |
|  | `findAmountMatches` | 금액 탐지 |
|  | `findOrgDictMatches` | 기관 사전 탐지 |
|  | `findOrgSuffixMatches` | 회사 접두·접미 패턴 탐지 |
|  | `findPersonMatches` | 한국 이름·직함·조사 패턴 탐지 |
|  | `collectMatches` | 탐지 패스 실행과 겹침 제거 |
|  | `detectEntities` | 사용자 검토용 자동 탐지 결과 생성 |
|  | `findCustomEntities` | 사용자가 직접 추가한 민감정보 탐지 |
|  | `tokenizeFromEntities` | 확정된 탐지만 토큰화 |
|  | `tokenizeText` | 자동 탐지 후 바로 토큰화하는 편의 함수 |
|  | `restoreText` | 문자열 토큰 복원 |
|  | `restoreDeep` | 중첩 배열·객체 재귀 복원 |
|  | `applyCorrections` | Claude의 전사 교정 내역 적용 |
| `lib/highlight.ts` | `buildOriginalSegments` | 원문 하이라이트 세그먼트 생성 |
|  | `buildTokenSegments` | 토큰 텍스트 하이라이트 세그먼트 생성 |
| `lib/meetingStore.ts` | `loadMeetings` | Local Storage 회의 조회 |
|  | `persist` | 회의 목록 저장 |
|  | `clearMeetings` | 전체 삭제 |
|  | `addMeeting` | 회의와 업무 추가 |
|  | `toggleTaskStatus` | 할일 완료 상태 전환 |
| `hooks/loadMicModule.ts` | `loadMicModule` | 브라우저 전용 마이크 모듈 동적 로드 |
| `hooks/useMeetingRecorder.ts` | `isMeetingRecorderSupported` | 브라우저 음성 기능 지원 여부 확인 |
|  | `useMeetingRecorder` | React 상태와 `MeetingRecorder` 생명주기 연결 |
| `public/mic.js` | `resampleTo16k` | 선형보간 16kHz 리샘플링 |
|  | `concatFloat32` | PCM 청크 결합 |
|  | `rms` | VAD용 RMS 음량 계산 |
|  | `MeetingRecorder` | 마이크·AudioWorklet·Worker·큐·VAD 통합 클래스 |
| `public/whisper-worker.js` | `collapseRepeats` | 연속 반복 구절 축약 |
|  | `isLikelyHallucination` | 알려진 환각 패턴 검사 |
|  | `stripBracketedText` | 대괄호 환각 문구 제거 |
|  | `splitSentences` | 필터링용 문장 분리 |
|  | `removeHallucinatedSentences` | 환각 키워드가 있는 문장 제거 |
|  | `getTranscriber` | WebGPU→WASM 순서로 Whisper 파이프라인 생성 |
| `public/pcm-worklet.js` | `PCMWorklet` | PCM 프레임을 전달하는 사용자 정의 AudioWorklet |

다음 React 컴포넌트도 프로젝트가 작성했습니다.

- `App`
- `HomeScreen`
- `InputScreen`
- `ConsentModal`
- `TokenReviewScreen`
- `ProcessingScreen`
- `ResultScreen`
- `DashboardScreen`
- `ActionChecklist`
- `HighlightedText`

각 화면 파일의 아이콘 함수(`InboxIcon`, `SparklesIcon`, `MicIcon`, `AlertIcon`, `ArrowRightIcon`, `HeroGraphic`)는 외부 아이콘 라이브러리가 아니라 JSX로 직접 작성한 표시용 컴포넌트입니다.

## 6. 라이브러리와 표준 API가 제공하는 기능

이미 라이브러리에 있는 기능은 다시 구현하지 않았습니다.

### 6-1. Express

`express` 패키지가 제공하는 형식입니다.

```js
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/shared', express.static(directory));
app.get(path, handler);
app.post(path, handler);
app.patch(path, handler);
app.delete(path, handler);
app.listen(port, callback);
```

- `express()`: 애플리케이션 생성
- `express.json()`: JSON 본문 파서
- `express.static()`: 정적 파일 미들웨어
- `app.get/post/patch/delete()`: HTTP 라우트 등록
- `res.status().json()`: 상태 코드와 JSON 응답

### 6-2. Anthropic SDK

`@anthropic-ai/sdk`가 제공하는 형식입니다.

```js
const anthropic = new Anthropic();
const response = await anthropic.messages.create({
  model,
  max_tokens,
  system,
  output_config: {
    effort,
    format: { type: 'json_schema', schema },
  },
  messages: [{ role: 'user', content }],
});
```

프로젝트는 HTTP 호출이나 인증 헤더를 직접 재구현하지 않고 SDK의 `messages.create()`를 사용합니다. 프로젝트가 직접 만든 부분은 전달할 프롬프트, JSON Schema, 재시도·검증 정책입니다.

### 6-3. React

React가 제공하는 기능입니다.

- `useState(initialValue)`: 화면 상태
- `useMemo(factory, dependencies)`: 계산값 메모이제이션
- `useEffect(effect, dependencies)`: Recorder와 이벤트 생명주기
- 함수 컴포넌트와 JSX 렌더링

프로젝트가 직접 만든 부분은 화면 컴포넌트, 상태 전환, 토큰 검토 사용자 흐름입니다.

### 6-4. Vite

- `import.meta.env.VITE_API_BASE_URL`: 빌드 환경변수
- `vite`: 개발 서버
- `tsc -b && vite build`: TypeScript 검사와 프로덕션 빌드

### 6-5. Transformers.js

CDN의 `@huggingface/transformers@3.0.2`가 제공합니다.

```js
const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-base',
  { device: 'webgpu', dtype: 'fp32' },
);
const output = await transcriber(audio, options);
```

- `pipeline(task, model, options)`: 모델과 추론 파이프라인 생성
- `env.allowLocalModels`: 모델 파일 조회 정책

프로젝트가 직접 만든 부분은 디바이스 폴백, 모델 진행상태 전달, 반복·환각 후처리입니다.

### 6-6. 브라우저 표준 API

- `fetch(url, options)`: 백엔드 HTTP 요청
- `navigator.mediaDevices.getUserMedia()`: 마이크 권한과 스트림
- `AudioContext`: 오디오 그래프
- `audioWorklet.addModule()`: AudioWorklet 모듈 등록
- `AudioWorkletNode`: PCM 처리 노드
- `Worker`: 별도 스레드
- `postMessage(value, transfer)`: 스레드 간 메시지와 버퍼 이전
- `localStorage.getItem/setItem/removeItem`: 브라우저 회의 기록

이 API의 내부 기능은 직접 구현하지 않았고 VeilNote 흐름에 맞춰 조합했습니다.

## 7. 메인 API 계약

### Request

```http
POST /api/process-meeting
Content-Type: application/json
```

```json
{
  "transcriptTokenized": "[PERSON_1] 팀장이 [ORG_1] 제안을 검토했습니다.",
  "participantTokens": ["[PERSON_1]"],
  "meetingTitle": "주간 회의"
}
```

원문과 매핑 테이블은 요청에 포함하지 않습니다.

### Success Response

```json
{
  "corrections": [],
  "summary": "[ORG_1] 제안을 검토하고 후속 업무를 확정했습니다.",
  "decisions": ["제안서를 수정합니다."],
  "tasks": [
    {
      "id": "task_1",
      "text": "제안서를 수정합니다.",
      "ownerToken": "[PERSON_1]",
      "priority": "P2",
      "status": "open"
    }
  ],
  "personalStar": {
    "situation": "제안 검토가 필요한 상황이었습니다.",
    "task": "요구사항을 정리해야 했습니다.",
    "action": "검토 내용을 정리했습니다.",
    "result": "후속 업무가 확정되었습니다."
  },
  "_meta": {
    "model": "configured-model"
  }
}
```

실제 응답의 업무 레코드에는 담당자·우선순위·마감일의 근거와 생성 시각 등 추가 필드가 포함됩니다.

## 8. 오류 처리

| HTTP | 상황 |
| --- | --- |
| `400` | 필수 입력 누락, 잘못된 필터·수정값 |
| `404` | 존재하지 않는 할일 |
| `422` | 토큰화되지 않은 차단 대상 개인정보 발견 |
| `502` | API 키 누락, 모델 거절, JSON 파싱 실패 등 LLM 처리 오류 |

프런트엔드는 `BackendApiError`에 HTTP 상태, 서버 `code`, `findings`를 보관합니다.

## 9. 실행과 검증

```bash
cd backend
npm ci
npm run demo
npm start
```

```bash
cd frontend
npm ci
npm run build
npm run lint
npm run dev
```

백엔드에는 별도 자동 테스트 스크립트가 없으며 `npm run demo`가 탐지·토큰화·유출 검사·업무 적재 흐름을 검증합니다. API 키가 없으면 실제 Claude 호출 직전에 정상 종료합니다.

## 10. 구현상 한계

- 업무 저장소는 서버 메모리 기반입니다.
- 프런트엔드 자동 탐지는 규칙과 사전 중심이라 완전한 NER가 아닙니다.
- 데모용 `/api/demo/tokenize`와 `/api/demo/restore`는 서버가 원문·매핑을 다루므로 실서비스 경로가 아닙니다.
- CORS가 `*`로 열려 있어 실제 배포 시 허용 출처 제한이 필요합니다.
- 외부 LLM 실제 호출에는 Anthropic API 키와 사용 가능한 모델 ID가 필요합니다.
