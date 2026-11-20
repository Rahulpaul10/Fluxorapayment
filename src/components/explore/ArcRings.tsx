/** Arc-inspired mark: concentric arcs that drift slowly. Purely decorative, hidden from assistive tech. */
export function ArcRings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 320" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="arcg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8257FF" />
          <stop offset="0.55" stopColor="#27D9FF" />
          <stop offset="1" stopColor="#FF55B8" />
        </linearGradient>
      </defs>
      <g className="arc-spin" style={{ transformOrigin: '160px 160px' }}>
        <path d="M 40 160 A 120 120 0 0 1 280 160" stroke="url(#arcg)" strokeWidth="3" strokeLinecap="round" opacity="0.95" />
        <path d="M 72 160 A 88 88 0 0 1 248 160" stroke="url(#arcg)" strokeWidth="2.5" strokeLinecap="round" opacity="0.65" />
        <path d="M 104 160 A 56 56 0 0 1 216 160" stroke="url(#arcg)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      </g>
      <circle cx="160" cy="160" r="5" fill="#27D9FF" />
    </svg>
  )
}
