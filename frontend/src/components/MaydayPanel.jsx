import { useEffect, useState } from 'react'
import { getMayday } from '../api'

function speak(lines) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  lines.forEach((l) => { const u = new SpeechSynthesisUtterance(l); u.rate = 0.95; window.speechSynthesis.speak(u) })
}

export default function MaydayPanel({ buildingId, rooms, liveMayday, onResult }) {
  const [room, setRoom] = useState('')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [voice, setVoice] = useState(true)

  const show = (m) => { setRes(m); onResult(m); if (voice && m) speak(m.directions) }

  // a mayday event from the live call stream
  useEffect(() => { if (liveMayday) { setRoom(liveMayday.from_room_id); show(liveMayday) } /* eslint-disable-next-line */ }, [liveMayday])
  useEffect(() => { setRes(null); setErr(null); onResult(null); window.speechSynthesis?.cancel() /* eslint-disable-next-line */ }, [buildingId])

  const go = async () => {
    if (!room) return
    setErr(null)
    try { show(await getMayday(buildingId, room)) } catch (e) { setErr(e.message) }
  }

  return (
    <div className="card mayday">
      <h3>Mayday · wall-following out</h3>
      <div className="inline">
        <select value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">Crew last seen in…</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button className="danger" onClick={go} disabled={!room}>MAYDAY</button>
      </div>
      <label className="small"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Read directions aloud</label>
      {err && <p className="err">{err}</p>}
      {res && (
        <div className="dirs">
          <p className="small"><b>{res.hand}</b> hand · {res.distance_m} m by wall ({res.shortest_m} m direct) · exit side {res.exit_side}</p>
          {res.advisory && <p className="small warn">{res.advisory}</p>}
          <ol>{res.directions.map((d, i) => <li key={i}>{d}</li>)}</ol>
          <button className="chip" onClick={() => speak(res.directions)}>🔊 Repeat</button>
          <button className="chip" onClick={() => { setRes(null); onResult(null); window.speechSynthesis?.cancel() }}>Clear</button>
        </div>
      )}
    </div>
  )
}
