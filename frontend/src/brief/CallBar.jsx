import { useEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon'

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

// What each fact update was about, for the markers on the timeline
function markerOf(f) {
  if (f.mayday) return { kind: 'trapped', label: 'Mayday' }
  const ch = f.briefing?.changes || []
  const c = ch.find((x) => x.kind === 'trapped') || ch.find((x) => x.kind === 'fire') || ch.find((x) => x.kind === 'hazard') || ch[0]
  if (!c) return { kind: 'fact', label: 'Facts updated' }
  const label = c.kind === 'trapped' ? 'Trapped' : c.kind === 'fire' ? 'Fire' : c.kind === 'hazard' ? 'Hazard' : 'Update'
  return { kind: c.kind, label, text: c.text }
}

// Transport for a replayed call: play/pause, skip, a scrub bar with a marker at each new fact, speed.
export default function CallBar({ player }) {
  const track = useRef(null)
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(false)
  const { t, duration: D, frames } = player
  const at = (e) => { const r = track.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D }
  const lines = player.utterancesAll || []

  useEffect(() => {
    if (!drag) return undefined
    const move = (e) => player.seek(at(e)); const up = () => setDrag(false)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input,textarea,select')) return
      if (e.key === ' ') { e.preventDefault(); player.status === 'live' ? player.pause() : player.play() }
      if (e.key === 'ArrowRight') player.seek(t + 5)
      if (e.key === 'ArrowLeft') player.seek(t - 5)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [player, t])

  if (!player.loaded) return null
  const nextFact = frames.find((f) => f.t > t + 0.05)
  const prevFact = [...frames].reverse().find((f) => f.t < t - 0.8)
  const playing = player.status === 'live'
  return (
    <div className="callbar" role="group" aria-label="Call playback">
      <button className="cb-btn" onClick={() => player.seek(prevFact ? prevFact.t : 0)} aria-label="Previous fact" title="Previous fact"><Icon name="prev" /></button>
      <button className="cb-btn cb-play" onClick={playing ? player.pause : player.play} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
      <button className="cb-btn" onClick={() => nextFact && player.seek(nextFact.t)} disabled={!nextFact} aria-label="Next fact" title="Skip to the next fact"><Icon name="next" /></button>
      <span className="cb-time">{fmt(t)}<small> / {fmt(D)}</small></span>
      <div className="cb-track" ref={track}
        onPointerDown={(e) => { setDrag(true); player.seek(at(e)) }}
        onPointerMove={(e) => setHover(at(e))} onPointerLeave={() => setHover(null)}
        role="slider" aria-label="Call position" aria-valuemin={0} aria-valuemax={Math.round(D)} aria-valuenow={Math.round(t)} tabIndex={0}>
        <div className="cb-rail">
          {lines.map((u, i) => <span key={i} className={`cb-utt ${u.role}`} style={{ left: `${u.start / D * 100}%`, width: `${(u.end - u.start) / D * 100}%` }} />)}
          <div className="cb-fill" style={{ width: `${t / D * 100}%` }} />
        </div>
        {frames.map((f, i) => {
          const m = markerOf(f)
          return (
            <button key={i} className={`cb-mark ${m.kind} ${f.t <= t ? 'past' : ''}`} style={{ left: `${f.t / D * 100}%` }}
              onPointerDown={(e) => { e.stopPropagation(); player.seek(f.t) }} title={m.text || m.label} aria-label={`${m.label} at ${fmt(f.t)}`}>
              {['trapped', 'fire', 'hazard'].includes(m.kind) ? <span>{m.label}</span> : <span className="tip">{m.text || m.label}</span>}
            </button>
          )
        })}
        <div className="cb-head" style={{ left: `${t / D * 100}%` }} />
        {hover != null && <div className="cb-hover" style={{ left: `${hover / D * 100}%` }}>{fmt(hover)}</div>}
      </div>
      <div className="seg cb-rate">{[1, 1.5, 2].map((r) => <button key={r} className={player.rate === r ? 'on' : ''} onClick={() => player.setRate(r)}>{r}×</button>)}</div>
      <button className="cb-btn" onClick={player.reset} aria-label="Close call" title="Close call"><Icon name="stop" /></button>
    </div>
  )
}
