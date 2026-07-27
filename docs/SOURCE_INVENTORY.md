# Source Inventory

## Team Source

| 항목 | 값 |
| --- | --- |
| 원본 저장소 | [`TRACEGATE/hackathon_2026`](https://github.com/TRACEGATE/hackathon_2026) |
| 반영 브랜치 | `main` |
| 반영 커밋 | `7619bc1341a6faad131a04f6c2817db7a694f7e2` |
| 반영 디렉터리 | `backend/`, `frontend/` |
| 원본 README 보관 | `docs/TEAM_REPOSITORY_README.md` |

원본의 백엔드는 Java가 아니라 Node.js/Express 기반 JavaScript ESM입니다. 원본 저장소의 `main`과 `veilnote-backend` 브랜치 및 도달 가능한 커밋에서 Java 파일, `pom.xml`, `build.gradle`은 확인되지 않았습니다.

## Included Source

### Backend

- `backend/src/server.js`
- `backend/src/meetingProcess.js`
- `backend/src/taskStore.js`
- `backend/src/shared/detector.js`
- `backend/src/shared/tokenizer.js`
- `backend/src/shared/leakGuard.js`
- `backend/scripts/demo.js`
- `backend/docs/API_SPEC.md`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/.env.example`
- `backend/.gitignore`

### Frontend

- React/TypeScript 화면과 상태 관리 코드
- 토큰화·복원·회의 저장소 코드
- 백엔드 API 연결 코드
- 마이크와 온디바이스 Whisper 코드
- Vite·TypeScript·Oxlint 설정
- `package.json`과 `package-lock.json`
- 공개 이미지·SVG 자산
- `.env.example`, `.gitignore`

## Replaced Legacy Prototype

처음 제공된 `public.zip`의 단일 HTML/JavaScript 프로토타입은 팀 저장소의 최신 React/TypeScript 프런트엔드보다 오래된 구성입니다. 중복과 실행 혼동을 피하기 위해 루트 `public/`을 제거하고 최신 원본의 `frontend/`로 교체했습니다.

원본 압축파일 해시는 다음과 같습니다.

```text
public.zip
SHA-256 00624ECC04118F9129EEE9B7881CF25EE59131AC61CCB5FF4FBA7F4C6D2942CD
```

필요하면 Git 이전 커밋에서 복구할 수 있습니다.

## Documents

| 저장소 경로 | 원본 |
| --- | --- |
| `docs/VeilNote_Development_Spec_v2.docx` | `VeilNote_개발명세서_v2.docx` |
| `docs/VeilNote_API_Spec.pdf` | `api_명세서.pdf` |
| `docs/PORTFOLIO.md` | 실제 코드 기반 포트폴리오 설명 |
| `docs/CODE_AND_API_GUIDE.md` | 코드·API·사용자 정의/라이브러리 구분 |
| `docs/TEAM_REPOSITORY_README.md` | 팀 원본 README 보존본 |

## Duplicate Files Omitted

| 중복 파일 | 원본 | SHA-256 |
| --- | --- | --- |
| `VeilNote_개발명세서_v2 (1).docx` | `VeilNote_개발명세서_v2.docx` | `5002D3B65EFB6609AC6722C49C42D0D56040A2DF6979FDD8839359C5FF5CC2C9` |
| `api_명세서 (1).pdf` | `api_명세서.pdf` | `1E733DDC2F93867442C2CB62DB071158B76A0E487AEBD4245E6F10DF074BFD37` |
| `public (1).zip` | `public.zip` | `00624ECC04118F9129EEE9B7881CF25EE59131AC61CCB5FF4FBA7F4C6D2942CD` |

## Demo Video

5분 5초 화면 녹화는 Git 이력에 넣지 않고 GitHub Release 자산으로 관리합니다.

- [VeilNote Demo Video · v0.1.0-demo](https://github.com/min-1225/Hackathon-CodeGate-2026/releases/tag/v0.1.0-demo)
- 자산명: `VeilNote-CodeGate-2026-Demo.zip`
- 크기: 42.5 MB

## Secret Review

- 실제 `.env` 파일은 포함하지 않았습니다.
- `.env.example`에는 `sk-ant-...` 자리표시자만 있습니다.
- 프런트엔드에는 Anthropic API 키가 없습니다.
- 루트와 패키지별 `.gitignore`가 `.env`, `node_modules`, 빌드 결과를 제외합니다.

## Additional Local Materials

다음 자료는 최종본·공개 범위가 확정되지 않아 포함하지 않았습니다.

- `TRACEGATE_PPT_VeilNote.pptx`와 PDF
- `VeilNote_예상질문답변.pdf`와 DOCX
- `veilnote질문 리스트.md`
- `VeilNote_Pitch_Deck.pptx`
- Notion API 명세 ZIP과 CSV
