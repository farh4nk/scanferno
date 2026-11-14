import { useCallback, useEffect, useRef, useState } from 'react'
import { createLiveSession, endLiveSession, liveAudio, liveUtterances, saveLiveSession } from '../api'

// A call happening now, through a /live session. Same state shape as useLiveCall, so the transcript,
// dispatch and briefing panels don't care which one feeds them. Inputs:
//   server   mic recording, re-sent whole every few seconds for ElevenLabs STT (speaker separation)
//   browser  the browser's own speech recognition (Chrome/Edge, no key); one voice, role picked by hand
//   typed    lines typed by hand (also works alongside browser mode)
// plus uploadFile() for a recorded call.
const UPLOAD_EVERY_MS = 4000
const EMPTY = { utterances: [], interim: '', record: null, recordN: 0, briefing: null, mayday: null, status: 'idle', listening: false, error: null, savedCallId: null, sessionBuildingId: null, buildingChanged: false }
const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
export const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

const indexed = (utts) => utts.map((u, index) => ({ ...u, index }))

export function useListen(buildingId) {
  const [state, setState] = useState(EMPTY)
  const [role, setRoleState] = useState('caller')
  const sid = useRef(null)
  const mode = useRef(null)
  const active = useRef(false)
  const t0 = useRef(0)
  const role$ = useRef('caller')
  const lines = useRef([])
  const media = useRef({ recorder: null, stream: null, chunks: [], timer: null })
  const recog = useRef(null)
  const pending = useRef({ busy: false, dirty: false })

  const setRole = (r) => { role$.current = r; setRoleState(r) }
  const fail = (msg) => setState((s) => ({ ...s, error: msg }))

  const syncBuilding = useRef(false) // session switched building; don't tear down the live session

  const apply = useCallback((r) => setState((s) => ({
    ...s,
    utterances: mode.current === 'server' ? indexed(r.utterances) : s.utterances,
    record: r.record ?? s.record,
    recordN: s.recordN + (r.extracted ? 1 : 0),
    briefing: r.briefing ?? s.briefing,
    mayday: r.mayday ?? s.mayday,
    sessionBuildingId: r.building_id || s.sessionBuildingId,
    buildingChanged: !!r.building_changed,
    error: null,
  })), [])

  const session = useCallback(async () => {
    if (!sid.current) sid.current = (await createLiveSession(buildingId)).session_id
    return sid.current
  }, [buildingId])

  // One request in flight at a time; anything that arrives meanwhile is sent right after.
  const send = useCallback(async (makeRequest) => {
    pending.current.dirty = true
    if (pending.current.busy) return
    pending.current.busy = true
    try {
      while (pending.current.dirty) {
        pending.current.dirty = false
        const id = await session()
        apply(await makeRequest(id))
      }
    } catch (e) {
      pending.current.dirty = false
      if (mode.current === 'server') {
        active.current = false
        stopMic()
        setState((s) => ({ ...s, status: 'error', listening: false, error: e.message }))
      } else fail(e.message)
    } finally { pending.current.busy = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, apply])

  const sendAudio = useCallback((firstRole) => {
    const { chunks, recorder } = media.current
    if (!chunks.length) return
    const type = recorder?.mimeType || 'audio/webm'
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
    send((id) => liveAudio(id, new Blob(media.current.chunks, { type }), `call.${ext}`, firstRole))
  }, [send])

  const sendLines = useCallback(() => send((id) => liveUtterances(id, lines.current)), [send])

  const addLine = useCallback((text, who = role$.current) => {
    text = text.trim()
    if (!text) return
    if (!t0.current) t0.current = performance.now()
    const now = (performance.now() - t0.current) / 1000
    const prevEnd = lines.current.at(-1)?.end ?? 0
    const start = Math.max(prevEnd, now - text.split(/\s+/).length / 2.6)
    lines.current = [...lines.current, { role: who, text, start: +start.toFixed(2), end: +now.toFixed(2) }]
    setState((s) => ({ ...s, utterances: indexed(lines.current), status: s.status === 'idle' ? 'live' : s.status }))
    if (!mode.current) mode.current = 'typed'
    sendLines()
  }, [sendLines])

  function stopMic() {
    const m = media.current
    clearInterval(m.timer)
    if (m.recorder && m.recorder.state !== 'inactive') m.recorder.stop()
    m.stream?.getTracks().forEach((t) => t.stop())
    m.recorder = null; m.stream = null
  }

  const startServer = async (firstRole) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m))
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    media.current = { recorder, stream, chunks: [], timer: null }
    let fresh = false
    recorder.ondataavailable = (e) => { if (e.data.size) { media.current.chunks.push(e.data); fresh = true } }
    recorder.onstop = () => sendAudio(firstRole) // last chunk lands just before stop
    recorder.start(1000)
    media.current.timer = setInterval(() => { if (fresh) { fresh = false; sendAudio(firstRole) } }, UPLOAD_EVERY_MS)
  }

  const startBrowser = () => {
    const r = new SpeechRecognition()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) addLine(res[0].transcript)
        else interim += res[0].transcript
      }
      setState((s) => ({ ...s, interim }))
    }
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      fail(`Speech recognition: ${e.error}${e.error === 'network' ? ' (needs internet)' : ''}`)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') active.current = false
    }
    r.onend = () => { if (active.current) try { r.start() } catch { /* already restarting */ } } // stops after silence
    recog.current = r
    r.start()
  }

  const start = useCallback(async (input, { firstRole = 'dispatcher' } = {}) => {
    setState((s) => ({ ...s, error: null, savedCallId: null, status: 'connecting' }))
    try {
      await session()
      mode.current = input
      active.current = true
      if (!t0.current) t0.current = performance.now()
      if (input === 'server') await startServer(firstRole)
      else if (input === 'browser') startBrowser()
      setState((s) => ({ ...s, status: 'live', listening: input !== 'typed' }))
    } catch (e) {
      active.current = false
      setState((s) => ({ ...s, status: 'error', listening: false, error: e.name === 'NotAllowedError' ? 'Microphone permission denied' : e.message }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const stop = useCallback(() => {
    active.current = false
    recog.current?.stop(); recog.current = null
    stopMic()
    setState((s) => ({ ...s, interim: '', listening: false, status: s.status === 'idle' ? 'idle' : 'done' }))
  }, [])

  const uploadFile = useCallback(async (file, firstRole = 'dispatcher') => {
    stop()
    mode.current = 'server'
    setState((s) => ({ ...s, status: 'transcribing', error: null }))
    try {
      apply(await liveAudio(await session(), file, file.name, firstRole))
      setState((s) => ({ ...s, status: 'done' }))
    } catch (e) { setState((s) => ({ ...s, status: 'error', error: e.message })) }
  }, [stop, session, apply])

  const save = useCallback(async (title) => {
    if (!sid.current) return null
    try {
      const { call_id: callId } = await saveLiveSession(sid.current, title)
      setState((s) => ({ ...s, savedCallId: callId }))
      return callId
    } catch (e) { fail(e.message); return null }
  }, [])

  const reset = useCallback(() => {
    stop()
    if (sid.current) endLiveSession(sid.current).catch(() => {})
    sid.current = null; mode.current = null; t0.current = 0; lines.current = []
    media.current = { recorder: null, stream: null, chunks: [], timer: null }
    pending.current = { busy: false, dirty: false }
    setState(EMPTY)
  }, [stop])

  useEffect(() => {
    if (syncBuilding.current) { syncBuilding.current = false; return }
    reset()
  }, [buildingId, reset]) // a session belongs to one building (unless the session itself switched)

  // Tell App the live call moved to another building without resetting the session.
  const acceptBuildingSync = useCallback(() => { syncBuilding.current = true }, [])

  return { ...state, role, setRole, start, stop, addLine, uploadFile, save, reset, acceptBuildingSync }
}
