import { useState } from 'react'
import { asset } from '../api'

const VIEWS = [['nadir', 'Top'], ['oblique-north', 'N'], ['oblique-east', 'E'], ['oblique-south', 'S'], ['oblique-west', 'W']]

export default function AerialPanel({ images, building, roof }) {
  const [view, setView] = useState('nadir')
  const src = images?.[view]
  return (
    <div className="card aerial">
      <h3>Aerial · Vexcel</h3>
      <div className="tabs">{VIEWS.map(([k, l]) => <button key={k} className={k === view ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      <div className="img">{src ? <img src={asset(src)} alt={`${view} aerial`} /> : <p className="muted">No imagery</p>}</div>
      <p className="small muted">
        {building?.stories}-story · built {building?.year_built} · {building?.construction} ·
        {building?.sprinklers ? ' sprinklered' : ' no sprinklers'}{building?.roof_height_m ? ` · roof ${building.roof_height_m} m` : ''}
        {roof ? ` · ${roof}` : ''}
      </p>
    </div>
  )
}
