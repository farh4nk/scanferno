import { useCallback, useEffect, useRef, useState } from 'react'
import { asset, getCallFrames } from '../api'

// Plays a scripted call from its precomputed frames, so it can be paused, scrubbed and skipped.
// The audio element is the clock when the call has audio; otherwise a timer stands in.
// Exposes the same shape as the live hooks: utterances, record, recordN, briefing, mayday, status.
const EMPTY = { data: null, t: 0, status: 'idle', error: null, jumped: false }

export function useCallPlayer() {
  const [s, setS] = useState(EMPTY)
  const audio = useRef(null)
  const timer = useRef(null)
  const clock = useRef({ base: 0, at: 0, rate: 1 })
  const raf = useRef(0)

  const now = () => {
    if (audio.current) return audio.current.currentTime
    const c = clock.current
    return c.at ? c.base + ((performance.now() - c.at) / 1000) * c.rate : c.base
  }
  const tick = useCallback(() => {
    setS((p) => {
      if (!p.data) return p
      const t = Math.min(now(), p.data.duration)
      if (t >= p.data.duration) { stopClock(); return { ...p, t: p.data.duration, status: 'done', jumped: false } }
      // ~10 updates a second is plenty for a transcript and a time readout
      if (Math.abs(t - p.t) < 0.1 && !p.jumped) return p
      return { ...p, t, jumped: false }
    })
    raf.current = requestAnimationFrame(tick)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopClock = () => {
    cancelAnimationFrame(raf.current)
    if (audio.current) audio.current.pause()
    else clock.current = { ...clock.current, base: now(), at: 0 }
  }
  const startClock = () => {
    if (audio.current) {
      // blocked autoplay or a missing file: keep the call moving on a timer, silently
      const a = audio.current
      a.play().catch(() => { if (audio.current === a) { const t = a.currentTime; audio.current = null; clock.current = { ...clock.current, base: t, at: performance.now() } } })
    }
    else clock.current = { ...clock.current, at: performance.now() }
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick)
  }

  const reset = useCallback(() => {
    stopClock(); clearTimeout(timer.current)
    if (audio.current) { audio.current.pause(); audio.current = null }
    clock.current = { base: 0, at: 0, rate: 1 }
    setS(EMPTY)
  }, [])

  const start = useCallback(async (call, speed = 1) => {
    reset()
    setS({ ...EMPTY, status: 'connecting' })
    try {
      const data = await getCallFrames(call.call_id)
      if (data.audio_url) {
        const a = new Audio(asset(data.audio_url)); a.playbackRate = speed; a.preload = 'auto'
        a.onended = () => { cancelAnimationFrame(raf.current); setS((p) => ({ ...p, t: data.duration, status: 'done' })) }
        audio.current = a
      }
      clock.current = { base: 0, at: 0, rate: speed }
      setS({ ...EMPTY, data, status: 'live' })
      startClock()
    } catch (e) {
      setS({ ...EMPTY, status: 'error', error: `Could not load the call (${e.message})` })
    }
  }, [reset]) // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => { stopClock(); setS((p) => (p.data ? { ...p, t: now(), status: 'paused' } : p)) }, []) // eslint-disable-line
  const play = useCallback(() => {
    setS((p) => {
      if (!p.data) return p
      if (p.status === 'done' || now() >= p.data.duration - 0.05) seekRaw(0)
      startClock(); return { ...p, status: 'live' }
    })
  }, []) // eslint-disable-line
  const seekRaw = (t) => {
    if (audio.current) audio.current.currentTime = t
    clock.current = { ...clock.current, base: t, at: clock.current.at ? performance.now() : 0 }
  }
  const seek = useCallback((t) => {
    setS((p) => {
      if (!p.data) return p
      const x = Math.max(0, Math.min(t, p.data.duration)); seekRaw(x)
      return { ...p, t: x, jumped: true, status: p.status === 'done' && x < p.data.duration ? 'paused' : p.status }
    })
  }, []) // eslint-disable-line
  const setRate = useCallback((r) => {
    clock.current = { base: now(), at: clock.current.at ? performance.now() : 0, rate: r }
    if (audio.current) audio.current.playbackRate = r
    setS((p) => ({ ...p }))
  }, []) // eslint-disable-line

  useEffect(() => reset, [reset])

  // what the call has revealed by time t
  const d = s.data
  const frames = d?.frames || []
  let idx = -1
  for (let i = 0; i < frames.length; i++) if (frames[i].t <= s.t) idx = i
  const facts = frames.slice(0, idx + 1).filter((f) => f.record)
  const last = facts.at(-1)
  const may = frames.slice(0, idx + 1).filter((f) => f.mayday).at(-1)
  return {
    status: s.status, error: s.error, t: s.t, duration: d?.duration || 0, rate: clock.current.rate, frames, frameIdx: idx, jumped: s.jumped,
    utterances: (d?.utterances || []).filter((u) => u.start <= s.t), utterancesAll: d?.utterances || [],
    record: last?.record || null, recordN: facts.length, briefing: last?.briefing || null, mayday: may?.mayday || null,
    loaded: !!d, start, reset, play, pause, seek, setRate,
  }
}
