import { useCallback, useEffect, useRef, useState } from 'react'
import { API, liveUrl } from './api'

const EMPTY = { utterances: [], record: null, recordN: 0, briefing: null, mayday: null, status: 'idle', error: null }

// Streams /calls/{id}/live (SSE) and plays the call audio when the stream opens.
export function useLiveCall() {
  const [state, setState] = useState(EMPTY)
  const es = useRef(null)
  const audio = useRef(null)

  const stop = useCallback(() => {
    es.current?.close()
    es.current = null
    if (audio.current) { audio.current.pause(); audio.current = null }
  }, [])

  const reset = useCallback(() => { stop(); setState(EMPTY) }, [stop])

  const start = useCallback((call, speed = 1) => {
    stop()
    setState({ ...EMPTY, status: 'connecting' })
    const src = new EventSource(liveUrl(call.call_id, speed))
    es.current = src
    const on = (name, fn) => src.addEventListener(name, (e) => fn(JSON.parse(e.data)))

    src.onopen = () => {
      setState((s) => ({ ...s, status: 'live' }))
      if (call.has_audio) {
        const a = new Audio(`${API}/fixtures/calls/${call.call_id}/audio.wav`)
        a.playbackRate = speed
        a.play().catch(() => {}) // autoplay may be blocked; the click that started the call normally allows it
        audio.current = a
      }
    }
    on('utterance', (u) => setState((s) => ({ ...s, utterances: [...s.utterances, u] })))
    on('record', (r) => setState((s) => ({ ...s, record: r.record, recordN: s.recordN + 1 })))
    on('briefing', (b) => setState((s) => ({ ...s, briefing: b })))
    on('mayday', (m) => setState((s) => ({ ...s, mayday: m })))
    on('done', () => { setState((s) => ({ ...s, status: 'done' })); src.close(); es.current = null })
    src.onerror = () => {
      // EventSource reconnects by default, which would replay the call; close instead.
      if (es.current) {
        setState((s) => (s.status === 'done' ? s : { ...s, status: 'error', error: 'Stream interrupted. Is the backend running?' }))
        src.close()
        es.current = null
      }
    }
  }, [stop])

  useEffect(() => stop, [stop])
  return { ...state, start, reset }
}
