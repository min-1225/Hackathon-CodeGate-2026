import { useState } from "react";

interface ConsentModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConsentModal({ onConfirm, onCancel }: ConsentModalProps) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title">
      <div className="modal-box">
        <h2 id="consent-modal-title" className="modal-title">
          음성 입력 동의가 필요합니다
        </h2>
        <p className="modal-body">
          이 회의는 받아쓰기 됩니다. 참석자 전원의 동의가 필요합니다. 음성은 이 기기 안에서 온디바이스
          AI 모델로 즉시 텍스트로 변환되며, 음성 데이터와 오디오는 서버나 외부 네트워크로 전혀 전송되지
          않고 저장되지도 않습니다. (최초 1회, 모델 파일 자체를 내려받기 위한 다운로드만 발생합니다.)
        </p>

        <label className="modal-checkbox-row">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>참석자 전원의 동의를 받았으며, 음성 받아쓰기를 진행하는 데 동의합니다.</span>
        </label>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={!checked}>
            동의하고 시작
          </button>
        </div>
      </div>
    </div>
  );
}
