import { useEffect, useRef, useState } from 'react'
import { search } from '../../api'
import { useDebounced } from '../../hooks/useDebounced'

const GOOD_SCORE = 0.75 // mirrors data/directory.py: below this, Enter asks the geocoder
const PAGE = 20
const EMPTY = { results: [], nearby: [], geocoded: null, total: 0 }

function Highlight({ text, query }) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g)
  if (!text || !words) return text || null
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

function Item({ r, query, active, onPick, onHover }) {
  const meta = [r.property_type, r.stories && `${r.stories} stories`, r.tenants != null && `${r.tenants} tenants`,
    r.models_count > 1 && `${r.models_count} 3D scans`, r.match === 'extra' && 'matched a scan, tenant or room',
    r.lat == null && 'no location',
    r.distance_m != null && (r.distance_m < 1000 ? `${r.distance_m} m away` : `${(r.distance_m / 1000).toFixed(1)} km away`)].filter(Boolean)
  return (
    <li className={`sr-item ${active ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(r) }} onMouseEnter={onHover}>
      <span className={`sr-status ${r.status}`}>{r.status === 'ready' ? 'briefing' : '3D scan'}</span>
      <span className="sr-text">
        <b><Highlight text={r.name} query={query} /></b>
        {r.address && r.address !== r.name && <span className="muted"> · <Highlight text={r.address} query={query} /></span>}
        <span className="sr-meta">{meta.join(' · ')}</span>
      </span>
    </li>
  )
}

// Header search over every known building (GET /search). Ready buildings open the briefing;
// scanned-only properties open a property card.
export default function AddressSearch({ current, onOpenBuilding, onOpenProperty }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState(EMPTY)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [err, setErr] = useState(null)
  const input = useRef(null)
  const list = useRef(null)
  const dq = useDebounced(q)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seq = useRef(0) // only the latest request may update the list
  const submitted = useRef(null) // query already searched by Enter; the debounced search skips it

  const run = (query, opts = {}) => {
    const id = ++seq.current
    setBusy(true); setErr(null)
    return search(query, { limit: PAGE, ...opts })
      .then((r) => {
        if (id !== seq.current) return null
        setRes(r); setActive(0)
        if (list.current) list.current.scrollTop = 0
        return r
      })
      .catch((e) => { if (id === seq.current) setErr(e.message); return null })
      .finally(() => { if (id === seq.current) setBusy(false) })
  }

  const loadMore = () => {
    if (more || busy || res.results.length >= res.total) return
    const id = seq.current
    setMore(true)
    search(res.query ?? q, { limit: PAGE, offset: res.results.length })
      .then((r) => { if (id === seq.current) setRes((cur) => ({ ...cur, results: [...cur.results, ...r.results], total: r.total })) })
      .catch((e) => { if (id === seq.current) setErr(e.message) })
      .finally(() => setMore(false))
  }

  useEffect(() => {
    if (open && submitted.current !== dq) run(dq)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, open])

  const items = [...res.results, ...res.nearby]

  const pick = (r) => {
    setOpen(false); setQ(''); input.current?.blur()
    if (r.status === 'ready') onOpenBuilding(r.building_id)
    else onOpenProperty(r)
  }

  // The backend only geocodes when nothing in the directory matches well, so this is safe for any query.
  const geocode = async () => {
    submitted.current = q
    const r = await run(q, { geocode: true })
    if (!r) return
    if (r.results[0]?.score >= GOOD_SCORE) pick(r.results[0])
    else if (!r.geocoded && !r.results.length) setErr(r.geocode_error ? 'Geocoder unavailable (offline?)' : 'No building or address matches')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
      if (active >= res.results.length - 3) loadMore()
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const stale = (res.query || '') !== q
      const good = res.results.some((r) => r.score >= GOOD_SCORE)
      if (q.trim() && (stale || (!good && !res.geocoded))) geocode()
      else if (items[active]) pick(items[active])
    }
  }

  useEffect(() => {
    list.current?.querySelector('.sr-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onScroll = (e) => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore()
  }

  const showGeocodeHint = q.trim() && !res.geocoded && !res.results.some((r) => r.score >= GOOD_SCORE)

  return (
    <div className="search">
      <input ref={input} value={q} onChange={(e) => { submitted.current = null; setQ(e.target.value); setOpen(true); setRes((r) => ({ ...r, geocoded: null, nearby: [] })) }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
        placeholder={current ? `${current.name} · ${current.address}` : 'Search an address, building, unit or tenant…'}
        aria-label="Search buildings by address" />
      <kbd className="search-kbd">/</kbd>
      {open && (
        <div className="search-pop" ref={list} onScroll={onScroll}>
          {err && <div className="sr-note err">{err}</div>}
          <div className="sr-head">
            {q.trim() ? 'Matches' : 'All buildings'}
            <span className="sr-total">{busy ? 'searching…' : `${res.total.toLocaleString()} ${res.total === 1 ? 'building' : 'buildings'}`}</span>
          </div>
          {res.results.length > 0 && (
            <ul>{res.results.map((r, i) => <Item key={r.id} r={r} query={q} active={i === active} onPick={pick} onHover={() => setActive(i)} />)}</ul>
          )}
          {!busy && !res.results.length && !res.geocoded && (
            <div className="sr-note muted">No building matches.</div>
          )}
          {res.results.length < res.total && (
            <div className="sr-note muted sr-more">{more ? 'Loading more…' : `Scroll for more (${(res.total - res.results.length).toLocaleString()} left)`}</div>
          )}
          {res.geocoded && (
            <>
              <div className="sr-head">Nearest known buildings to {res.geocoded.display_name.split(',').slice(0, 3).join(',')}</div>
              <ul>{res.nearby.map((r, i) => {
                const idx = res.results.length + i
                return <Item key={`n-${r.id}`} r={r} query="" active={idx === active} onPick={pick} onHover={() => setActive(idx)} />
              })}</ul>
            </>
          )}
          {showGeocodeHint && !busy && <div className="sr-note muted">Press Enter to look up “{q}” on the map and list the nearest scanned buildings.</div>}
        </div>
      )}
    </div>
  )
}
