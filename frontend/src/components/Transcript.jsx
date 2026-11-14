import { useEffect, useRef } from 'react'

export default function Transcript({ utterances, status, interim, emptyText = 'Press “Start call” to replay the dispatch call.' }) {
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [utterances.length, interim])
  return (
    <div className="card transcript">
      <h3>Live transcript {status === 'live' && <span className="dot live" />}</h3>
      <div className="scroll">
        {utterances.length === 0 && !interim && <p className="muted">{status === 'connecting' ? 'Connecting…' : emptyText}</p>}
        {utterances.map((u) => (
          <div key={u.index} className={`utt ${u.role}`}>
            <span className="who">{u.role}</span>
            <span>{u.text}</span>
          </div>
        ))}
        {interim && <div className="utt interim"><span className="who">hearing…</span><span>{interim}</span></div>}
        <div ref={end} />
      </div>
    </div>
  )
}
