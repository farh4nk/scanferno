import { useEffect, useRef } from 'react'

// While a call is being taken: the call sheet fills in field by field as the caller says things,
// with the transcript underneath. The plan and key band on the left update from the same record.
const FIELDS = [['address', 'Address'], ['floor', 'Floor'], ['side', 'Fire side'], ['conditions', 'Conditions'], ['trapped', 'Trapped'], ['hazards', 'Hazards']]
// a trapped person reads as "who (where)"; other lists are joined
const item = (x) => (typeof x === 'object' ? [x.description, x.location && `(${x.location})`].filter(Boolean).join(' ') : x)
const show = (v) => (Array.isArray(v) ? v.map(item).join('; ') : v == null ? '' : String(v))
const ROLE = { dispatcher: 'Dispatch', caller: 'Caller' }

export default function LiveSide({ feed, onSeek, hearT }) {
  const box = useRef(null)
  const r = feed.record; const c = r?.confidence || {}; const ch = new Set(r?.changed || [])
  const filled = FIELDS.filter(([k]) => show(r?.[k])).length
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [feed.utterances.length, feed.interim])
  return (
    <div className="liveside">
      <div className="card sheet">
        <h3>Call sheet <span>{filled}/{FIELDS.length} filled{feed.recordN ? ` · update ${feed.recordN}` : ''}</span></h3>
        {FIELDS.map(([k, label]) => {
          const v = show(r?.[k])
          return (
            <div key={`${k}-${ch.has(k) ? feed.recordN : 0}`} className={`sh-row ${v ? 'has' : ''} ${ch.has(k) ? 'flash' : ''}`}>
              <span className="sh-k">{label}</span>
              <span className="sh-v">{v || 'listening…'}</span>
              {v && c[k] != null && <span className="sh-c">{Math.round(c[k] * 100)}%</span>}
            </div>
          )
        })}
      </div>
      <div className="card tx">
        <h3>Transcript <span>{onSeek ? 'tap a line to hear it · ' : ''}{feed.utterances.length} lines</span></h3>
        <div className="tx-lines" ref={box}>
          {feed.utterances.length === 0 && !feed.interim && <p className="muted">Waiting for the first words. The transcript refreshes every few seconds.</p>}
          {feed.utterances.map((u, i) => (
            <div key={i} className={`tl ${u.role} ${onSeek && u.start != null ? 'seekable' : ''} ${hearT != null && u.start != null && hearT >= u.start && hearT < (u.end ?? u.start + 1) ? 'hearing' : ''}`}
              onClick={onSeek && u.start != null ? () => onSeek(u.start) : undefined} title={onSeek ? 'Hear this line' : undefined}><b>{ROLE[u.role] || u.role}</b><span>{u.text}</span></div>
          ))}
          {feed.interim && <div className="tl caller interim"><b>…</b><span>{feed.interim}</span></div>}
        </div>
      </div>
    </div>
  )
}
