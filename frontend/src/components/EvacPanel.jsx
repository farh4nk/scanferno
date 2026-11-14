import { useEffect, useRef, useState } from 'react'
import { getEvac } from '../api'

export default function EvacPanel({ buildingId, onFrame, onResult = () => {} }) {
  const [n, setN] = useState(30)
  const [res, setRes] = useState(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [err, setErr] = useState(null)
  const timer = useRef(null)

  useEffect(() => { stop(); setRes(null); onFrame(null); onResult(null) /* eslint-disable-next-line */ }, [buildingId])
  const stop = () => { clearInterval(timer.current); setPlaying(false) }

  const run = async () => {
    stop(); setErr(null)
    try {
      const r = await getEvac(buildingId, n)
      setRes(r); onResult(r); setT(0); onFrame(r.frames[0]); setPlaying(true)
      let i = 0
      timer.current = setInterval(() => {
        i += 1
        if (i >= r.frames.length) { clearInterval(timer.current); setPlaying(false); return }
        setT(i); onFrame(r.frames[i])
      }, 450)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => () => clearInterval(timer.current), [])

  return (
    <div className="card evac">
      <h3>Evacuation sim</h3>
      <div className="inline">
        <input type="range" min="5" max="150" value={n} onChange={(e) => setN(+e.target.value)} />
        <span>{n} people</span>
        <button onClick={run}>{playing ? 'Restart' : 'Run'}</button>
        {res && <button className="chip" onClick={() => { stop(); setRes(null); onFrame(null); onResult(null) }}>Clear</button>}
      </div>
      {err && <p className="err">{err}</p>}
      {res && (
        <p className="small">
          Cleared in <b>{res.clear_time_s}s</b> · bottleneck door <b>{res.bottleneck_door_id}</b> · t={res.frames[t]?.t}s
          {res.advice?.map((a, i) => <span key={i} className="warn"><br />{a}</span>)}
        </p>
      )}
    </div>
  )
}
