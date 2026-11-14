import { useEffect, useState } from 'react'
import { getBriefing, getFloorplan } from '../api'

// Floor plan + the no-call baseline briefing for one building. Stale responses from a previous
// building are dropped so fast switching from search never shows the wrong plan.
export function useBuildingData(buildingId) {
  const [state, setState] = useState({ plan: null, briefing: null, error: null })

  useEffect(() => {
    if (!buildingId) return undefined
    let alive = true
    setState({ plan: null, briefing: null, error: null })
    const fail = (e) => alive && setState((s) => ({ ...s, error: e.message }))
    getFloorplan(buildingId).then((plan) => alive && setState((s) => ({ ...s, plan }))).catch(fail)
    getBriefing(buildingId).then((briefing) => alive && setState((s) => ({ ...s, briefing }))).catch(fail)
    return () => { alive = false }
  }, [buildingId])

  return state
}
