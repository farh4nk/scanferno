import { useId } from 'react'

// The Scanferno mark: a flame cut into audio-meter bars (the live call, burning). Red at the base to amber at the tip.
const FLAME = 'M12 1c1.2 7 9.5 10 9.5 19.5A9.5 9.5 0 0 1 12 30 9.5 9.5 0 0 1 2.5 20.5C2.5 15 5.5 13 7 8.5c1.6 2.4 2.4 3.4 4 4C10.4 9.4 10 5 12 1z'
const BARS = [[15, 14], [20.5, 6], [26, 0], [31.5, 10], [37, 3], [42.5, 12], [48, 18]].map(([x, cut]) => ({ x, h: 62 - cut }))

export default function Logo({ size = 36, title = 'Scanferno' }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="logo" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="62" x2="0" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d42a1e" /><stop offset=".55" stopColor="#ff5a1f" /><stop offset="1" stopColor="#ffb36b" />
        </linearGradient>
        <clipPath id={`c${id}`}><path transform="translate(9 2) scale(1.9 1.875)" d={FLAME} /></clipPath>
      </defs>
      <g clipPath={`url(#c${id})`} fill={`url(#g${id})`}>
        {BARS.map((b) => <rect key={b.x} x={b.x - 1.9} y="0" width="3.8" height={b.h} rx="1.9" />)}
      </g>
    </svg>
  )
}
