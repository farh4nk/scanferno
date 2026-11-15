// Demo: preset building briefing plus scripted calls. Live test: nothing is preloaded, the briefing is built from the call you take.
export default function ModeSwitch({ mode, onChange, calling }) {
  return (
    <div className="modesw" role="group" aria-label="App mode">
      <button className={mode === 'demo' ? 'on' : ''} onClick={() => onChange('demo')} aria-pressed={mode === 'demo'} title="Preset briefing and scripted demo calls">Demo</button>
      <button className={mode === 'live' ? 'on live' : ''} onClick={() => onChange('live')} aria-pressed={mode === 'live'} title="Take a real call with the microphone">
        {calling && <span className="dotlive" />}Live test
      </button>
    </div>
  )
}
