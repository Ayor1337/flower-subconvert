// Windows 的 Segoe UI Emoji 不含国旗字形，区域指示符会退化为
// "US""JP" 这类字母对。这里用内联 SVG 自绘国旗，保证全平台一致。

const US_STRIPES = Array.from({ length: 7 }, (_, i) => (
  <rect key={`s${i}`} y={(i * 40) / 13} width="38" height={20 / 13} fill="#b22234" />
));

const US_STARS = Array.from({ length: 30 }, (_, i) => (
  <circle
    key={`t${i}`}
    cx={1.75 + (i % 6) * 2.55}
    cy={1.7 + Math.floor(i / 6) * 1.86}
    r="0.48"
    fill="#fff"
  />
));

function FlagUS() {
  return (
    <svg viewBox="0 0 38 20" preserveAspectRatio="none">
      <rect width="38" height="20" fill="#fff" />
      {US_STRIPES}
      <rect width="15.2" height="10.8" fill="#3c3b6e" />
      {US_STARS}
    </svg>
  );
}

function FlagJP() {
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </svg>
  );
}

function FlagNL() {
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#21468b" />
      <rect width="30" height="13.34" fill="#fff" />
      <rect width="30" height="6.67" fill="#ae1c28" />
    </svg>
  );
}

// 枫叶为左右对称的简化轮廓，中心线 x=12，配合平移缩放落到旗面中央
const MAPLE_LEAF =
  "M12 2 L13.5 6 L17 4 L16 8 L21 8 L17.5 11 L20.5 14 L16.5 14.5 " +
  "L18 18.5 L14 17 L14 21 L10 21 L10 17 L6 18.5 L7.5 14.5 " +
  "L3.5 14 L6.5 11 L3 8 L8 8 L7 4 L10.5 6 Z";

function FlagCA() {
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#fff" />
      <rect width="7.5" height="20" fill="#d52b1e" />
      <rect x="22.5" width="7.5" height="20" fill="#d52b1e" />
      <path
        d={MAPLE_LEAF}
        fill="#d52b1e"
        transform="translate(6.7 2.1) scale(0.69)"
      />
    </svg>
  );
}

const FLAGS = {
  us: FlagUS,
  jp: FlagJP,
  nl: FlagNL,
  ca: FlagCA,
};

export default function Flag({ code }) {
  const Specific = FLAGS[code?.toLowerCase()];
  if (!Specific) {
    return <span className="flag-code">{code}</span>;
  }
  return (
    <span className="flag" aria-hidden="true">
      <Specific />
    </span>
  );
}
