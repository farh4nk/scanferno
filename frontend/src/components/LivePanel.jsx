import { useEffect, useRef, useState } from 'react'
import { SpeechRecognition, canRecord } from '../hooks/useListen'

// Controls for a call happening now: mic (server STT or browser speech), upload a recording, type lines, save.
export default function LivePanel({ listen, stt, onSaved }) {
  const inputs = [
    ['server', 'Mic → ElevenLabs (separates speakers)', stt && canRecord],
    ['browser', 'Mic → browser speech (no key)', !!SpeechRecognition],
    ['typed', 'Typed lines only', true],
  ]
  const [input, setInput] = useState(() => inputs.find(([, , ok]) => ok)[0])
  const [firstRole, setFirstRole] = useState('dispatcher')
  const [text, setText] = useState('')
  const file = useRef(null)
  const on = listen.listening || listen.status === 'connecting'
  const busy = listen.status === 'transcribing'

  // the server STT flag arrives after the first render
  useEffect(() => { if (input === 'browser' && stt && canRecord && !on && !listen.utterances.length) setInput('server') /* eslint-disable-next-line */ }, [stt])

  const submit = (e) => { e.preventDefault(); listen.addLine(text); setText('') }
  const save = async () => {
    const id = await listen.save()
    if (id) onSaved(id)
  }

  return (
    <div className="card livepanel">
      <h3>Live call {on && <span className="dot live" />}</h3>
      <div className="inline">
        <select value={input} onChange={(e) => setInput(e.target.value)} disabled={on}>
          {inputs.map(([k, label, ok]) => <option key={k} value={k} disabled={!ok}>{label}{ok ? '' : ' (unavailable)'}</option>)}
        </select>
      </div>
      {input === 'server' && (
        <div className="inline small">
          <span className="muted">First voice is the</span>
          <span className="seg">
            {['dispatcher', 'caller'].map((r) => <button key={r} className={firstRole === r ? 'on' : ''} onClick={() => setFirstRole(r)} disabled={on}>{r}</button>)}
          </span>
        </div>
      )}
      {input !== 'server' && (
        <div className="inline small">
          <span className="muted">Speaking as</span>
          <span className="seg">
            {['caller', 'dispatcher'].map((r) => <button key={r} className={listen.role === r ? 'on' : ''} onClick={() => listen.setRole(r)}>{r}</button>)}
          </span>
        </div>
      )}
      <div className="inline">
        {input !== 'typed' && (on
          ? <button onClick={listen.stop}>■ Stop</button>
          : <button className="primary" onClick={() => listen.start(input, { firstRole })} disabled={busy}>● Listen</button>)}
        {stt && (
          <>
            <button onClick={() => file.current.click()} disabled={on || busy} title="Transcribe a recorded call with ElevenLabs">⇪ Upload recording</button>
            <input ref={file} type="file" accept="audio/*,video/webm" hidden
              onChange={(e) => { if (e.target.files[0]) listen.uploadFile(e.target.files[0], firstRole); e.target.value = '' }} />
          </>
        )}
        <button onClick={save} disabled={!listen.utterances.length || on || busy} title="Save as a replayable call in fixtures/calls/">Save call</button>
        <button className="chip" onClick={listen.reset} disabled={busy}>Clear</button>
      </div>
      {input !== 'server' && (
        <form className="inline" onSubmit={submit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Type a ${listen.role} line…`} />
          <button disabled={!text.trim()}>Add</button>
        </form>
      )}
      <p className="small muted">
        {busy && 'Transcribing recording… '}
        {input === 'server' && on && 'Recording; the transcript refreshes every few seconds. '}
        {input === 'browser' && 'Recognition runs in the browser (Chrome/Edge, needs internet). Switch “speaking as” when the other side talks. '}
        {!stt && 'Server transcription is off (no ELEVENLABS_API_KEY). '}
        {listen.recordN > 0 && `${listen.recordN} record update${listen.recordN > 1 ? 's' : ''}.`}
      </p>
      {listen.savedCallId && <p className="small">Saved as <code>{listen.savedCallId}</code>; pick it under Replay.</p>}
      {listen.error && <p className="small err">{listen.error}</p>}
    </div>
  )
}
