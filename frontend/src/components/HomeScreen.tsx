import shieldLogo from "../assets/Logo1.png";

interface HomeScreenProps {
  onStart: () => void;
}

// 배경에 흩뿌리는 옅은 점 장식. 매 렌더마다 위치가 바뀌지 않도록 컴포넌트 밖에 고정 좌표로 둔다.
const BACKGROUND_DOTS: Array<{ cx: number; cy: number; r: number; opacity: number }> = [
  { cx: 40, cy: 60, r: 1.4, opacity: 0.5 },
  { cx: 120, cy: 20, r: 1, opacity: 0.35 },
  { cx: 380, cy: 40, r: 1.6, opacity: 0.45 },
  { cx: 410, cy: 140, r: 1, opacity: 0.3 },
  { cx: 30, cy: 220, r: 1.2, opacity: 0.4 },
  { cx: 60, cy: 380, r: 1.4, opacity: 0.5 },
  { cx: 400, cy: 380, r: 1.2, opacity: 0.4 },
  { cx: 420, cy: 300, r: 1, opacity: 0.3 },
  { cx: 220, cy: 15, r: 1, opacity: 0.35 },
  { cx: 150, cy: 430, r: 1.2, opacity: 0.35 },
  { cx: 300, cy: 440, r: 1, opacity: 0.3 },
  { cx: 90, cy: 150, r: 0.9, opacity: 0.3 },
];

function HeroGraphic() {
  return (
    <svg
      viewBox="0 0 440 460"
      className="home-hero-graphic"
      role="img"
      aria-label="VeilNote 방패 아이콘과 보안·협업·AI를 나타내는 궤도 그래픽"
    >
      <defs>
        <radialGradient id="pedestalGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5b7fe0" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#2c4a8f" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#2c4a8f" stopOpacity="0" />
        </radialGradient>
        <filter id="shieldRim" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#8fb0ff" floodOpacity="0.55" />
        </filter>
      </defs>

      {BACKGROUND_DOTS.map((dot, i) => (
        <circle key={i} cx={dot.cx} cy={dot.cy} r={dot.r} fill="#c9d6ff" opacity={dot.opacity} />
      ))}

      <g stroke="#5b78c4" strokeOpacity="0.35" fill="none">
        <ellipse cx="220" cy="205" rx="195" ry="72" transform="rotate(-8 220 205)" strokeWidth="1" />
        <ellipse cx="220" cy="205" rx="150" ry="98" transform="rotate(6 220 205)" strokeWidth="1" />
        <ellipse cx="220" cy="330" rx="150" ry="26" strokeWidth="1" strokeOpacity="0.25" />
        <ellipse cx="220" cy="330" rx="190" ry="34" strokeWidth="1" strokeOpacity="0.15" />
      </g>

      <ellipse cx="220" cy="333" rx="86" ry="16" fill="url(#pedestalGlow)" />

      <image
        href={shieldLogo}
        x="163"
        y="118"
        width="114"
        height="130"
        filter="url(#shieldRim)"
      />

      <g transform="translate(220 46)">
        <circle r="26" fill="#101d3d" fillOpacity="0.55" stroke="#8fa6e6" strokeWidth="1.2" />
        <g stroke="#e4ebff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="-6.5" y="-1.5" width="13" height="10" rx="2" />
          <path d="M -4.5 -1.5 v -3.5 a 4.5 4.5 0 0 1 9 0 v 3.5" />
        </g>
        <circle cx="0" cy="3.5" r="1.1" fill="#e4ebff" />
      </g>

      <g transform="translate(52 318)">
        <circle r="26" fill="#101d3d" fillOpacity="0.55" stroke="#8fa6e6" strokeWidth="1.2" />
        <g stroke="#e4ebff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="-4.5" cy="-3" r="3.4" />
          <circle cx="4.5" cy="-3" r="3.4" />
          <path d="M -10 6.5 a 5.5 5.5 0 0 1 11 0" />
          <path d="M -0.5 6.5 a 5.5 5.5 0 0 1 11 0" />
        </g>
      </g>

      <g transform="translate(388 318)">
        <rect x="-24" y="-17" width="48" height="34" rx="9" fill="#101d3d" fillOpacity="0.55" stroke="#8fa6e6" strokeWidth="1.2" />
        <text x="0" y="6" textAnchor="middle" fontSize="14" fontWeight="700" fill="#e4ebff" fontFamily="inherit">
          AI
        </text>
      </g>
    </svg>
  );
}

export default function HomeScreen({ onStart }: HomeScreenProps) {
  return (
    <div className="home-page">
      <div className="home-page-glow home-page-glow--top" aria-hidden="true" />
      <div className="home-page-glow home-page-glow--bottom" aria-hidden="true" />

      <div className="home-page-brand">
        <img src={shieldLogo} alt="" className="home-page-logo" />
        <span className="home-page-wordmark">VeilNote</span>
      </div>

      <div className="home-page-content">
        <div className="home-page-copy">
          <h1 className="home-page-title">
            회의는 안전하게,
            <br />
            할일은 <span className="home-page-title-accent">정확하게</span>
          </h1>
          <p className="home-page-description">
            회의 내용을 안전하게 기록하고
            <br />
            AI가 요약과 할일을 자동으로 정리합니다.
          </p>
          <button type="button" className="home-page-cta" onClick={onStart}>
            시작하기
          </button>
        </div>

        <div className="home-page-graphic-wrap">
          <HeroGraphic />
        </div>
      </div>
    </div>
  );
}
