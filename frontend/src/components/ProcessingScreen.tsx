interface ProcessingScreenProps {
  tokenCount: number;
}

export default function ProcessingScreen({ tokenCount }: ProcessingScreenProps) {
  return (
    <div className="vn-page vn-page--processing">
      <div className="processing-card">
        <div className="processing-loader" aria-hidden="true" />
        <h2 className="processing-title">안전하게 처리하고 있습니다</h2>

        <ul className="processing-timeline">
          <li className="processing-timeline-item processing-timeline-item--done">
            <span className="timeline-icon">✓</span>
            민감정보 {tokenCount}건을 로컬에서 보호 처리 완료
          </li>
          <li className="processing-timeline-item processing-timeline-item--active">
            <span className="timeline-icon timeline-icon--spin" />
            보호 처리된 텍스트만 백엔드로 전달해 요약·결정사항 생성 중
          </li>
        </ul>

        <p className="processing-footnote">
          실제 회사명·고객사명·금액·인명은 이 브라우저 밖으로 전송되지 않습니다.
        </p>
      </div>
    </div>
  );
}
