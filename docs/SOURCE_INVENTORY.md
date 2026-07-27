# Source Inventory

## Included

| 저장소 경로 | 원본 | 상태 |
| --- | --- | --- |
| `public/index.html` | `public.zip` | 원형 보존 |
| `public/mic.js` | `public.zip` | 원형 보존 |
| `public/pcm-worklet.js` | `public.zip` | 원형 보존 |
| `public/whisper-worker.js` | `public.zip` | 원형 보존 |
| `docs/VeilNote_Development_Spec_v2.docx` | `VeilNote_개발명세서_v2.docx` | 파일명만 영문으로 정리 |
| `docs/VeilNote_API_Spec.pdf` | `api_명세서.pdf` | 파일명만 영문으로 정리 |
| `docs/PORTFOLIO.md` | 분석 결과 | 프로젝트·역할·면접용 설명 |
| `docs/CODE_AND_API_GUIDE.md` | 분석 결과 | 코드 구조·API·사용자 정의/라이브러리 구분 |

## Duplicate Files Omitted

다음 파일은 SHA-256 해시가 원본과 같아 저장소에 중복으로 넣지 않았습니다.

| 중복 파일 | 원본 | SHA-256 |
| --- | --- | --- |
| `VeilNote_개발명세서_v2 (1).docx` | `VeilNote_개발명세서_v2.docx` | `5002D3B65EFB6609AC6722C49C42D0D56040A2DF6979FDD8839359C5FF5CC2C9` |
| `api_명세서 (1).pdf` | `api_명세서.pdf` | `1E733DDC2F93867442C2CB62DB071158B76A0E487AEBD4245E6F10DF074BFD37` |
| `public (1).zip` | `public.zip` | `00624ECC04118F9129EEE9B7881CF25EE59131AC61CCB5FF4FBA7F4C6D2942CD` |

## Demo Video

제공된 Edge 화면 녹화는 5분 5초이며, 압축 해제한 MP4가 약 369MB입니다. Git 저장소 본문에 대용량 바이너리를 커밋하지 않고 GitHub Release 자산으로 분리합니다.

## Missing Source

현재 자료만으로 전체 애플리케이션을 재현하려면 다음 파일이 추가로 필요합니다.

- 백엔드 서버 진입점
- API 라우트
- LLM 클라이언트와 프롬프트
- 서버 측 residual-PII guard
- 업무 저장소 구현
- `/shared/tokenizer.js`
- `/shared/detector.js`
- `/shared/leakGuard.js`
- `package.json`
- lock 파일
- `.env.example`
- 테스트

누락 코드는 문서에 적힌 이름만 보고 임의로 구현하지 않았습니다.

## Additional Local Materials Found

다음 관련 자료도 로컬 폴더에서 확인했지만, 사용자가 처음 지정한 파일이 아니거나 최종본 여부가 불명확해 저장소에는 포함하지 않았습니다.

- `TRACEGATE_PPT_VeilNote.pptx`와 PDF
- `VeilNote_예상질문답변.pdf`와 DOCX
- `veilnote질문 리스트.md`
- `VeilNote_Pitch_Deck.pptx`
- Notion API 명세 ZIP과 CSV

최종본·공개 가능 여부가 확인되면 `docs/presentation/` 또는 GitHub Release에 추가할 수 있습니다.
