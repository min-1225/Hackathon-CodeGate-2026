# Public Prototype

이 폴더는 제공된 `public.zip`의 브라우저 프로토타입 코드를 원형 그대로 보존합니다.

## Files

| 파일 | 역할 |
| --- | --- |
| `index.html` | 녹음 동의, NER, 토큰화 미리보기, API 연결, 로컬 복원 UI |
| `mic.js` | 마이크 캡처, 음성구간 감지, 리샘플링, Whisper 작업 큐 |
| `pcm-worklet.js` | AudioWorklet에서 PCM 프레임 전달 |
| `whisper-worker.js` | 브라우저 Whisper 추론과 WebGPU/WASM 폴백 |

## Required but Missing

`index.html`은 다음 공용 모듈을 import하지만 제공된 압축에는 파일이 없습니다.

```text
/shared/tokenizer.js
/shared/detector.js
/shared/leakGuard.js
```

또한 `POST /api/process`를 제공하는 백엔드 소스가 포함되어 있지 않습니다. 따라서 이 폴더만 정적 서버로 열어도 전체 기능은 실행되지 않습니다.

## Code Ownership Notes

프로젝트 사용자 정의 코드:

- `resampleTo16k`
- `concatFloat32`
- `rms`
- `MeetingRecorder`
- `getTranscriber`

라이브러리·브라우저 제공 API:

- Transformers.js의 `pipeline`, `env`
- Web Audio API의 `AudioContext`, `AudioWorkletNode`, `AudioWorkletProcessor`
- Web Worker의 `Worker`, `postMessage`
- 브라우저의 `fetch`, `localStorage`, `SpeechSynthesisUtterance`

자세한 내용은 [`docs/CODE_AND_API_GUIDE.md`](../docs/CODE_AND_API_GUIDE.md)를 참고하십시오.
