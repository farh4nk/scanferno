import { useState } from 'react'
import { ask } from '../api'

const IDEAS = ['Where is the nearest exit from the break room?', 'Which rooms are the worst for disorientation?', 'Which door will jam first?']

export default function AskPanel({ buildingId, dispatch, onHighlight }) {
  const [q, setQ] = useState('')
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)

  const send = async (text) => {
    if (!text.trim() || busy) return
    setBusy(true); setQ('')
    try {
      const r = await ask(buildingId, text, dispatch || {})
      setLog((l) => [{ q: text, a: r.answer, src: r.source }, ...l])
      onHighlight(r.highlight || null)
    } catch (e) {
      setLog((l) => [{ q: text, a: `Error: ${e.message}`, src: 'error' }, ...l])
    } finally { setBusy(false) }
  }

  return (
    <div className="card ask">
      <h3>Ask the plan</h3>
      <form onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. fastest way out from Office 110?" />
        <button disabled={busy}>{busy ? '…' : 'Ask'}</button>
      </form>
      <div className="chips">{IDEAS.map((i) => <button key={i} className="chip" onClick={() => send(i)}>{i}</button>)}</div>
      <div className="scroll">
        {log.map((m, i) => (
          <div key={i} className="qa"><div className="q">{m.q}</div><div className="a">{m.a} <span className="muted small">[{m.src}]</span></div></div>
        ))}
      </div>
    </div>
  )
}
