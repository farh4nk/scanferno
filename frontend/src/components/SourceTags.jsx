const NAMES = { costar: 'CoStar', vexcel: 'Vexcel', matterport: 'Matterport', dispatch: 'Call' }

// Which data layer(s) a briefing claim came from.
export default function SourceTags({ sources, source }) {
  const list = sources || (source ? [source] : [])
  if (!list.length) return null
  return <span className="srcs">{list.map((s) => <span key={s} className={`src-tag ${s}`}>{NAMES[s] || s}</span>)}</span>
}
