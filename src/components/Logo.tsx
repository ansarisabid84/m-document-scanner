/** Document Scanner brand mark: a page inside scan-frame corners on an ink-blue tile. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="Document Scanner">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5D71F2" />
          <stop offset="1" stopColor="#2A3AA8" />
        </linearGradient>
        <linearGradient id="lg-hi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="26" fill="url(#lg-bg)" />
      <rect width="96" height="96" rx="26" fill="url(#lg-hi)" />
      <path d="M33 24h22l11 11v35a3 3 0 0 1-3 3H33a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M55 24v9a2 2 0 0 0 2 2h9" fill="#C9D1FA" />
      <path d="M37 45h22M37 52h22M37 59h14" stroke="#9AA6EA" strokeWidth="3.5" strokeLinecap="round" />
      <g stroke="#8BE6C3" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M18 30v-8a4 4 0 0 1 4-4h8" />
        <path d="M66 18h8a4 4 0 0 1 4 4v8" />
        <path d="M78 66v8a4 4 0 0 1-4 4h-8" />
        <path d="M30 78h-8a4 4 0 0 1-4-4v-8" />
      </g>
    </svg>
  );
}
