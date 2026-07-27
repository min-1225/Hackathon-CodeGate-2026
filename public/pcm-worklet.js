// VeilNote — PCM 캡처 워클릿 (오디오 렌더 스레드)
//
// 마이크 입력의 원시 Float32 프레임을 그대로 메인 스레드로 전달한다.
// 여기서는 저장·전송을 하지 않는다(오디오는 기기 안에서만 흐른다).

class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      // 복사본을 넘겨야 함(원본 버퍼는 재사용됨)
      this.port.postMessage(input[0].slice(0));
    }
    return true; // 계속 처리
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
