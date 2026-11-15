// One stroke icon set (24 px grid, 2.2 stroke) so every icon matches.
const P = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  call: <path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  facts: <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3" />,
  rescue: <><circle cx="12" cy="7" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></>,
  entry: <path d="M4 21V4h10v17M14 12h7M18 9l3 3-3 3" />,
  hazards: <path d="M12 3l9 16H3zM12 9v5M12 17v.5" />,
  hose: <><path d="M4 18c4 0 4-12 8-12s4 12 8 12" /><circle cx="4" cy="18" r="1.5" /></>,
  exterior: <path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" />,
  aerial: <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6" />,
  plan: <path d="M3 4h18v16H3zM3 12h8V4M11 20v-4h10" />,
  mayday: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="4" /></>,
  evac: <path d="M14 4a2 2 0 1 0 0 .1M9 21l3-7 3 3v4M7 11l4-3 4 2 3 3" />,
  ask: <path d="M4 5h16v11H9l-5 4z" />,
  play: <path d="M7 5l12 7-12 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <path d="M6 6h12v12H6z" />,
  speak: <path d="M5 9v6h4l5 4V5L9 9zM17 9a4 4 0 0 1 0 6" />,
  model: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  route: <path d="M6 20a2 2 0 1 0 0-.1M18 4a2 2 0 1 0 0 .1M8 20h7a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7" />,
  prev: <path d="M7 5v14M18 6l-8 6 8 6z" />,
  next: <path d="M17 5v14M6 6l8 6-8 6z" />,
  all: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  brief: <path d="M3 10.5 12 4l9 6.5M5 9v11h14V9M9 20v-6h6v6" />,
}
export default function Icon({ name }) {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{P[name]}</svg>
}
