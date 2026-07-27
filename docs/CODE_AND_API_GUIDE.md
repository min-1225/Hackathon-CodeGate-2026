# VeilNote 코드 및 API 해설

## 1. 분석 범위

이 문서는 다음 실제 자료를 기준으로 작성했습니다.

- `public/index.html`
- `public/mic.js`
- `public/pcm-worklet.js`
- `public/whisper-worker.js`
- `api_명세서.pdf`
- `VeilNote_개발명세서_v2.docx`

중요한 제한이 있습니다.

- `index.html`이 import하는 `/shared/tokenizer.js`, `/shared/detector.js`, `/shared/leakGuard.js`는 `public.zip`에 없습니다.
- 백엔드 라우트와 LLM 호출 소스도 제공 파일에 없습니다.
- 따라서 아래 설명은 실제로 확인한 프런트 코드, API 계약, 개발 명세를 구분해 기술합니다.
- 라이브러리에 없는 메서드를 라이브러리 기능인 것처럼 설명하지 않습니다. 프로젝트 사용자 정의 코드와 라이브러리·브라우저 제공 API를 별도 표로 분리했습니다.

## 2. 파일 구조

```text
public/
├── index.html
├── mic.js
├── pcm-worklet.js
└── whisper-worker.js

필요하지만 현재 압축에 없는 경로
shared/
├── tokenizer.js
├── detector.js
└── leakGuard.js

현재 제공되지 않은 영역
backend/
├── server entry
├── API routes
├── LLM client
├── residual PII guard
└── task store
```

## 3. 전체 실행 흐름

```text
사용자가 녹음 시작
  -> 동의 체크
  -> 동의 시각을 localStorage에 기록
  -> Speech Synthesis로 육성 고지
  -> getUserMedia로 마이크 획득
  -> AudioWorklet이 PCM 프레임 전달
  -> MeetingRecorder가 RMS 기반으로 발화/무음 판정
  -> 발화 구간을 16kHz로 리샘플링
  -> Web Worker의 Whisper 작업 큐에 추가
  -> Transformers.js가 브라우저에서 한국어 받아쓰기
  -> 받아쓰기 결과를 원문 입력창에 반영
  -> 규칙 + 사전 + NER로 민감정보 탐지
  -> 사용자가 탐지 결과 확인·수정
  -> 토큰화와 매핑 생성
  -> 잔존 원문 검사
  -> 백엔드 API 호출
  -> 결과를 로컬 매핑으로 복원
  -> 팀 요약·개인 STAR 결과 렌더링
```

## 4. 파일별 코드 해설

### 4-1. `index.html`

역할은 UI와 전체 오케스트레이션입니다.

- 녹음 동의 모달과 육성 고지
- Whisper 모델 프리로드
- 받아쓰기 결과를 입력창에 반영
- 온디바이스 NER 로드·실행
- 개인정보 후보를 칩 UI로 표시
- 사용자의 탐지 포함·제외와 수동 추가
- 토큰화 본문과 매핑 테이블 미리보기
- 클라이언트 유출검사
- 백엔드 API 호출과 오류 UI
- 응답의 로컬 복원과 결과 표시

실제 요청 코드는 다음 계약을 사용합니다.

```js
fetch('/api/process', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    tokenizedTranscript: tokenized,
    selfToken: selfToken || undefined,
    meetingTitle: '회의',
  }),
});
```

`fetch`, `JSON.stringify`는 브라우저가 제공하는 표준 API입니다. `/api/process` 경로, 요청 필드 이름, 응답 처리 방식은 프로젝트에서 정한 계약입니다.

### 4-2. `mic.js`

`MeetingRecorder` 클래스가 마이크와 Whisper 워커 사이를 조정합니다.

핵심 책임은 다음과 같습니다.

- 마이크 스트림 생성
- AudioWorklet 연결
- 프레임 RMS 계산
- 발화와 무음 구간 판정
- 너무 짧은 잡음 구간 제거
- 16kHz 리샘플링
- Whisper 작업 큐 직렬화
- 무음 자동 종료
- 오디오 노드와 마이크 트랙 정리

작업 큐를 둔 이유는 여러 발화 구간이 짧은 시간에 만들어져도 무거운 Whisper 추론을 동시에 여러 번 실행하지 않기 위해서입니다. `_inFlight`가 `true`이면 대기하고, 결과가 돌아온 뒤 `_drain()`이 다음 작업을 보냅니다.

### 4-3. `pcm-worklet.js`

`PCMWorklet`은 `AudioWorkletProcessor`를 상속한 프로젝트 클래스입니다.

```js
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
```

`AudioWorkletProcessor`, `this.port.postMessage`, `registerProcessor`는 Web Audio API가 제공합니다. `PCMWorklet`과 `process` 본문의 전달 방식은 프로젝트 코드입니다. `slice(0)`은 브라우저가 재사용하는 입력 버퍼와 분리된 복사본을 넘기기 위해 사용합니다.

### 4-4. `whisper-worker.js`

Whisper 추론을 UI 스레드와 분리합니다.

- `@huggingface/transformers` 3.0.2를 CDN에서 import
- `Xenova/whisper-base` 모델 사용
- WebGPU `fp32` 우선
- 실패하면 WASM `q8` 폴백
- 30초 청크와 5초 stride로 긴 음성 처리
- 결과와 진행률을 메인 스레드로 전송

`getTranscriber(preferWebGPU)`는 프로젝트에서 만든 사용자 정의 함수입니다. Transformers.js의 `pipeline`을 여러 실행 장치 옵션으로 호출하고 성공한 인스턴스를 캐시하는 역할을 합니다.

## 5. 사용자 정의 코드

다음 항목은 라이브러리에 원래 존재하는 메서드가 아니라 이 프로젝트에서 작성하거나 별도 프로젝트 모듈로 둔 코드입니다.

| 이름 | 위치 | 역할 | 소스 확인 |
| --- | --- | --- | --- |
| `resampleTo16k(input, inputSr)` | `mic.js` | PCM을 16kHz로 선형보간 리샘플링 | 확인 |
| `concatFloat32(chunks)` | `mic.js` | 여러 `Float32Array`를 하나로 병합 | 확인 |
| `rms(frame)` | `mic.js` | 프레임의 RMS 음량 계산 | 확인 |
| `MeetingRecorder` | `mic.js` | 마이크·VAD·작업 큐·워커 오케스트레이션 | 확인 |
| `getTranscriber(preferWebGPU)` | `whisper-worker.js` | Whisper 파이프라인 생성·캐시·장치 폴백 | 확인 |
| `getRecorder()` | `index.html` | `MeetingRecorder` 싱글 인스턴스 생성 | 확인 |
| `startRecordingUI()` | `index.html` | 녹음 시작 UI 상태 변경 | 확인 |
| `finishRecordingUI()` | `index.html` | 녹음 종료와 결과 UI 반영 | 확인 |
| `loadNer()` | `index.html` | NER 파이프라인 지연 로드·캐시 | 확인 |
| `nerGroupToType(group)` | `index.html` | NER 라벨을 프로젝트 토큰 타입으로 변환 | 확인 |
| `runNer(text)` | `index.html` | NER 실행 결과를 탐지 포맷으로 변환 | 확인 |
| `renderChips()` | `index.html` | 탐지 후보 검토 UI 렌더링 | 확인 |
| `activeDetections()` | `index.html` | 사용자가 포함한 탐지만 필터링 | 확인 |
| `refresh()` | `index.html` | 하이라이트·토큰화·매핑 미리보기 갱신 | 확인 |
| `escapeHtml(text)` | `index.html` | 미리보기의 HTML 특수문자 이스케이프 | 확인 |
| `buildDetections()` | `/shared/tokenizer.js` | 규칙·사전·NER 탐지 병합 | 압축에 소스 없음 |
| `applyTokenization()` | `/shared/tokenizer.js` | 원문을 토큰으로 치환하고 매핑 생성 | 압축에 소스 없음 |
| `nerToDetections()` | `/shared/tokenizer.js` | NER 출력을 프로젝트 탐지 포맷으로 변환 | 압축에 소스 없음 |
| `restore()` | `/shared/tokenizer.js` | 토큰화 응답을 로컬 매핑으로 복원 | 압축에 소스 없음 |
| `resolveOverlaps()` | `/shared/detector.js` | 겹치는 탐지 범위 해결 | 압축에 소스 없음 |
| `checkResidualOriginals()` | `/shared/leakGuard.js` | 원래 값이 토큰화 결과에 남았는지 검사 | 압축에 소스 없음 |
| `assertNoRawEntity()` | v2 개발 명세 | 전송 payload에 매핑 원문이 남았는지 검사 | 명세만 있고 소스 없음 |

`buildDetections`, `applyTokenization`, `nerToDetections`, `restore`, `resolveOverlaps`, `checkResidualOriginals`, `assertNoRawEntity`는 사용하는 형태와 의도는 문서·import에서 확인되지만 구현 파일은 제공되지 않았습니다. 전체 소스를 공개할 때 이 파일들을 반드시 함께 포함해야 합니다.

## 6. 라이브러리와 브라우저가 제공하는 기능

직접 다시 구현할 필요가 없는 기능입니다.

### Transformers.js

```js
import { pipeline, env } from '@huggingface/transformers';
```

| API | 형식 | 역할 |
| --- | --- | --- |
| `pipeline(task, model, options)` | 비동기 팩토리 함수 | 지정한 모델과 작업의 추론 파이프라인 생성 |
| `env.allowLocalModels` | 환경 설정 속성 | 로컬 모델 검색 허용 여부 설정 |

프로젝트에서 사용한 형식:

```js
const asr = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-base',
  { device: 'webgpu', dtype: 'fp32' },
);

const ner = await pipeline(
  'token-classification',
  'Xenova/bert-base-multilingual-cased-ner-hrl',
);
```

생성된 파이프라인은 함수처럼 호출합니다.

```js
const result = await asr(audio, {
  language: 'korean',
  task: 'transcribe',
});
```

### Web Audio API

| API | 형식 | 역할 |
| --- | --- | --- |
| `navigator.mediaDevices.getUserMedia()` | Promise 반환 메서드 | 마이크 스트림 획득 |
| `new AudioContext(options)` | 생성자 | 오디오 처리 그래프 생성 |
| `audioContext.audioWorklet.addModule(url)` | Promise 반환 메서드 | 워클릿 모듈 등록 |
| `new AudioWorkletNode(context, name)` | 생성자 | 등록된 프로세서 노드 생성 |
| `createMediaStreamSource(stream)` | 메서드 | 마이크 스트림을 오디오 노드로 변환 |
| `connect(node)` / `disconnect()` | 노드 메서드 | 오디오 그래프 연결·해제 |

### Web Worker

| API | 형식 | 역할 |
| --- | --- | --- |
| `new Worker(url, { type: 'module' })` | 생성자 | 별도 스레드 모듈 워커 생성 |
| `worker.postMessage(data, transfer)` | 메서드 | 워커에 메시지와 transferable 전달 |
| `worker.onmessage` | 이벤트 핸들러 | 워커 결과 수신 |
| `worker.terminate()` | 메서드 | 워커 종료 |

### 기타 브라우저 표준 API

- `fetch()`는 HTTP 요청을 보냅니다.
- `localStorage.getItem()`과 `setItem()`은 브라우저 로컬 키-값 저장소를 사용합니다.
- `SpeechSynthesisUtterance`와 `speechSynthesis.speak()`는 안내 음성을 재생합니다.
- `Float32Array`는 PCM 샘플 버퍼에 사용합니다.
- `JSON.parse()`와 `JSON.stringify()`는 JSON 변환을 담당합니다.

위 기능은 브라우저나 라이브러리가 제공하므로 프로젝트에서 다시 구현하지 않았습니다.

## 7. 실제 프런트 요청 계약

### Request

```json
{
  "tokenizedTranscript": "[PERSON_1]: [CLIENT_1] 계약을 진행하기로 했습니다.",
  "selfToken": "[PERSON_1]",
  "meetingTitle": "회의"
}
```

### Expected Response

프런트 코드가 직접 참조하는 필드는 다음과 같습니다.

```json
{
  "teamSummary": {},
  "personalStar": {},
  "_meta": {
    "model": "..."
  }
}
```

이 계약은 `public/index.html`의 `/api/process` 연동에서 확인됩니다.

## 8. v2 메인 API 계약

### `POST /api/process-meeting`

Request:

```json
{
  "transcriptTokenized": "[PERSON_1]: [CLIENT_1]과의 계약 건을 진행하기로 했습니다.",
  "participantTokens": ["[PERSON_1]", "[PERSON_2]"],
  "meetingTitle": "3분기 영업 회의"
}
```

Response의 핵심 구조:

```json
{
  "summary": "회의 전체 요약",
  "decisions": ["결정 사항"],
  "tasks": [
    {
      "id": "task_...",
      "text": "[CLIENT_1]에 최종 견적서 발송",
      "ownerToken": "[PERSON_2]",
      "ownerReason": "본인이 발송을 맡겠다고 발언",
      "priority": "P1",
      "priorityReason": "회의에서 명시적 기한이 언급됨",
      "dueOffsetDays": 11,
      "dueReason": "다음 주 금요일까지라고 발언",
      "status": "open"
    }
  ]
}
```

백엔드는 실제 날짜를 만들지 않고 `dueOffsetDays`를 반환합니다. 절대 날짜는 프런트가 회의 시작 시각과 상대일수로 계산합니다.

## 9. 업무 API 계약

| Method | Endpoint | 요청/필터 | 응답 |
| --- | --- | --- | --- |
| `GET` | `/api/tasks` | `status`, `ownerToken`, `meetingId` | `tasks`, `stats` |
| `GET` | `/api/tasks/:id` | path `id` | 단일 `task` |
| `PATCH` | `/api/tasks/:id` | `status`, `text`, `ownerToken`, `priority` 중 일부 | 수정된 `task`, 재계산 `stats` |
| `DELETE` | `/api/tasks/:id` | path `id` | `ok`, 재계산 `stats` |

업무 목록 정렬은 미완료 우선, `P1` → `P2` → `P3`, 생성일 역순으로 정의되어 있습니다.

`PATCH`에서 `status`가 `done`이 되면 `completedAt`을 채우고 다시 `open`으로 바꾸면 `null`로 되돌립니다. 담당자나 우선순위를 사람이 수정하면 자동 추천 근거 대신 “사용자가 직접 배정/조정”으로 변경합니다.

## 10. 오류 처리

| Status | 상황 | 프런트 대응 |
| ---: | --- | --- |
| `400` | 필수 필드 누락 또는 허용되지 않는 값 | 입력값 재확인 |
| `404` | 업무 ID 없음 | 목록 갱신 후 재시도 |
| `422` | 토큰화되지 않은 잔존 PII | 누락 경고, 원문 재확인·마스킹 |
| `502` | API 키 미설정, 모델 거절, LLM 호출 실패 | 임시 오류 안내와 재시도 |

`422`는 일반 입력 오류와 분리해야 합니다. 이 응답은 “서버 오류”가 아니라 보안 정책이 정상 작동한 결과이므로, 프런트는 토큰화 누락 항목을 다시 확인하도록 안내해야 합니다.

## 11. 버전 불일치

현재 자료에는 다음 차이가 있습니다.

| 항목 | 프로토타입 프런트 | v2 API 명세 |
| --- | --- | --- |
| 메인 경로 | `/api/process` | `/api/process-meeting` |
| 요청 본문 | `tokenizedTranscript`, `selfToken`, `meetingTitle` | `transcriptTokenized`, `participantTokens`, `meetingTitle` |
| 결과 | `teamSummary`, `personalStar` | `summary`, `decisions`, `tasks` |
| 목표 | 요약과 개인 성과 | 회의 후 업무 실행 시스템 |

통합할 때는 아래 중 하나를 선택해야 합니다.

1. `/api/v1/process`와 `/api/v2/process-meeting`처럼 버전 경로를 분리합니다.
2. 백엔드 어댑터가 구 요청을 v2 계약으로 변환합니다.
3. 프런트와 백엔드를 동시에 v2 계약으로 마이그레이션하고 구 경로를 일정 기간 유지합니다.

해커톤 프로젝트를 공개한다면 1번이 가장 설명하기 쉽습니다.

## 12. 현재 압축만으로 실행되지 않는 이유

`index.html`은 다음 모듈을 절대 경로로 import합니다.

```js
import {
  buildDetections,
  applyTokenization,
  nerToDetections,
  restore,
} from '/shared/tokenizer.js';
import { resolveOverlaps } from '/shared/detector.js';
import { checkResidualOriginals } from '/shared/leakGuard.js';
```

그러나 `public.zip`에는 `public/`의 네 파일만 있습니다. 따라서 정적 서버로 압축을 열어도 import가 `404`가 되고, 개인정보 탐지·토큰화·복원·유출검사가 동작하지 않습니다. `/api/process`를 처리할 백엔드도 없으므로 전체 플로우를 재현할 수 없습니다.

## 13. 공개 저장소에 필요한 최소 구조

```text
veilnote/
├── README.md
├── package.json
├── package-lock.json 또는 pnpm-lock.yaml
├── .env.example
├── .gitignore
├── public/
│   ├── index.html
│   ├── mic.js
│   ├── pcm-worklet.js
│   └── whisper-worker.js
├── shared/
│   ├── tokenizer.js
│   ├── detector.js
│   └── leakGuard.js
├── src/
│   ├── server.js
│   ├── routes/
│   ├── llm/
│   └── taskStore/
└── test/
    ├── tokenizer.test.js
    ├── leakGuard.test.js
    └── processMeeting.test.js
```

이 구조는 권장 예시이며 현재 제공 자료에 존재하는 구조라고 주장하는 것은 아닙니다. `shared`와 `src`의 실제 경로는 원본 백엔드 프로젝트에 맞춰야 합니다.

## 14. `.gitignore` 처리

이 VeilNote 저장소에는 API 키와 빌드 산출물을 보호하기 위한 `.gitignore`를 추가했습니다. 실제 코드 저장소에서는 이를 삭제하지 않는 것이 안전합니다. 최소한 다음은 커밋에서 제외해야 합니다.

```gitignore
.env
.env.*
!.env.example
node_modules/
dist/
.cache/
*.log
```

이 패턴은 Git이 기본 제공하는 기능이 아니라 프로젝트 저장소에 직접 작성하는 설정입니다. 특히 `.env`에는 LLM API 키나 Slack Webhook URL이 들어갈 수 있으므로 공개하면 안 됩니다.

## 15. 테스트 우선순위

1. 이메일·전화번호·주민등록번호·카드번호 정규식 테스트
2. 사전 탐지와 NER 탐지 범위 중첩 테스트
3. 동일 문자열 반복 등장 시 토큰 매핑 테스트
4. 매핑 원문이 하나라도 남을 때 전송 차단 테스트
5. 매핑 테이블이 API payload에 포함되지 않는지 테스트
6. `422` 응답에서 `preview`가 마스킹되는지 테스트
7. LLM이 잘못된 담당자 토큰을 반환했을 때 검증 테스트
8. `/api/process`와 `/api/process-meeting` 버전 호환 테스트
9. WebGPU 실패 시 WASM 폴백 테스트
10. 녹음 종료 시 마이크 트랙·AudioContext·Worker 정리 테스트

## 16. 개선 권장사항

- CDN import에만 의존하지 말고 모델·라이브러리 캐시 전략과 오프라인 조건을 명시합니다.
- API 요청과 응답을 JSON Schema 또는 Zod 같은 검증 스키마로 관리합니다.
- 프런트와 백엔드가 같은 타입을 사용하도록 공유 타입 패키지를 둡니다.
- 인메모리 업무 저장소는 재시작 시 사라지므로 IndexedDB 또는 영속 저장소와 책임 범위를 명확히 합니다.
- 로그에는 요청 ID, 상태 코드, 처리시간만 남기고 본문은 남기지 않습니다.
- 백엔드 소스를 공개할 때 실제 비밀값이 Git 기록에 들어간 적이 없는지 확인합니다.
- 데모 영상은 개인정보를 검수한 뒤 짧은 GIF와 전체 영상 링크로 분리합니다.

## 17. 결론

이 프로젝트의 핵심은 단순히 Whisper와 LLM을 연결한 것이 아니라, “원문은 기기에 남고 서버에는 토큰만 간다”는 데이터 경계를 기준으로 음성 처리, 개인정보 탐지, 사용자 확인, 백엔드 게이트, LLM 호출, 로컬 복원을 하나의 흐름으로 연결한 것입니다.

포트폴리오에서는 백엔드 API를 많이 만들었다는 설명보다, 보안 규칙을 요청·응답 계약과 프런트 UX까지 일관되게 구현했다는 점을 중심으로 보여주는 것이 가장 설득력 있습니다.
