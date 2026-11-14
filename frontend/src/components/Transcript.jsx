import { useEffect, useRef } from 'react'

export default function Transcript({ utterances, status }) {
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [utterances.length])
  return (
    <div className="card transcript">
      <h3>Live transcript {status === 'live' && <span className="dot live" />}</h3>
      <div className="scroll">
        {utterances.length === 0 && <p className="muted">{status === 'connecting' ? 'Connecting…' : 'Press “Start call” to replay the dispatch call.'}</p>}
        {utterances.map((u) => (
          <div key={u.index} className={`utt ${u.role}`}>
            <span className="who">{u.role}</span>
            <span>{u.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  )
}
