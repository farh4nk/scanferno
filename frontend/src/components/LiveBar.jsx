import { useEffect, useState } from 'react'
import Icon from '../ui/Icon'

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// The header control while a call is being taken: clock, a mic meter (so you can see it hears you),
// who is speaking when the browser recognizer is used, and the one button that ends the call.
export default function LiveBar({ listen, onEnd }) {
  const [tick, setTick] = useState({ now: Date.now(), level: 0 })
  useEffect(() => {
    const t = setInterval(() => setTick({ now: Date.now(), level: listen.levelRef.current }), 120)
    return () => clearInterval(t)
  }, [listen.levelRef])
  const secs = Math.max(0, Math.round((tick.now - listen.startedAt) / 1000))
  const lit = Math.round(tick.level * 7)
  const lines = listen.utterances.length
  const connecting = listen.status === 'connecting'
  return (
    <div className="livebar" role="group" aria-label="Live call">
      <span className="livetag"><span className="dotlive" />{connecting ? 'Connecting' : 'Live'}</span>
      <b className="livetime">{fmt(secs)}</b>
      {listen.mode === 'server' && (
        <span className="meter" role="img" aria-label="Microphone level">
          {Array.from({ length: 7 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} style={{ height: 6 + i * 3 }} />)}
        </span>
      )}
      {listen.mode === 'browser' && (
        <span className="seg" title="Browser speech hears one voice: say who is talking">
          {['caller', 'dispatcher'].map((r) => <button key={r} className={listen.role === r ? 'on' : ''} onClick={() => listen.setRole(r)}>{r}</button>)}
        </span>
      )}
      <span className="livehint">{lines ? `${lines} line${lines > 1 ? 's' : ''}` : 'listening'}</span>
      <button className="btn red" onClick={onEnd}><Icon name="stop" />End call</button>
    </div>
  )
}
