// Spoken output in ElevenLabs voices (POST /speech), with word timings so captions follow the voice.
import { asset, speech } from '../api'

const memo = new Map() // `${voice}|${text}` -> Promise<{audio_url, words}>

export function prepare(text, voice = 'narrator') {
  const key = `${voice}|${text}`
  if (!memo.has(key)) {
    const p = speech(text, voice).then((r) => { new Audio(asset(r.audio_url)).preload = 'auto'; return r })
    p.catch(() => memo.delete(key))
    memo.set(key, p)
  }
  return memo.get(key)
}

// Character ranges of each timed word inside the original text, for highlighting
function ranges(text, words) {
  let at = 0
  return words.map((w) => {
    const i = text.indexOf(w.word, at)
    const s = i < 0 ? at : i; const e = i < 0 ? at : i + w.word.length
    at = e
    return { ...w, s, e }
  })
}

// Plays one line. onWord({s, e}) fires as each word is spoken; resolves when the line ends or is stopped.
export function speak(text, { voice = 'narrator', onWord, onStart } = {}) {
  let audio = null; let raf = 0; let stopped = false; let done
  const finished = new Promise((res) => { done = res })
  const stop = () => { stopped = true; cancelAnimationFrame(raf); if (audio) { audio.pause(); audio.src = '' } done('stopped') }
  prepare(text, voice).then((r) => {
    if (stopped) return
    const rs = ranges(text, r.words || [])
    audio = new Audio(asset(r.audio_url))
    const loop = () => {
      const t = audio.currentTime; let cur = null
      for (const w of rs) { if (w.start <= t) cur = w; else break }
      if (cur) onWord?.(cur)
      raf = requestAnimationFrame(loop)
    }
    audio.onended = () => { cancelAnimationFrame(raf); onWord?.({ s: text.length, e: text.length }); done('ended') }
    audio.onerror = () => { cancelAnimationFrame(raf); done('error') }
    audio.play().then(() => { onStart?.(); loop() }).catch(() => done('error'))
  }).catch(() => done('error'))
  return { stop, finished }
}
