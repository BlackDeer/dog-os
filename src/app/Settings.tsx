import { useEffect, useState } from 'react'
import { startFileCamera } from '../sensing/camera'
import { senses } from '../sensing/senses'
import { setSettings, useSettings, type Settings } from '../store/settings'
import type { Screen } from './App'

export function SettingsScreen({ go }: { go: (s: Screen) => void }) {
  const s = useSettings()
  const [adv, setAdv] = useState(false)
  const [usage, setUsage] = useState('')
  useEffect(() => { void navigator.storage?.estimate?.().then((e) => setUsage(`${Math.round((e.usage ?? 0) / 1e6)} MB used on this device`)) }, [])
  const num = (k: keyof Settings, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) } as Partial<Settings>)
  const bool = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ [k]: e.target.checked } as Partial<Settings>)
  return (
    <div className="settings">
      <h2>Settings</h2>
      <label className="row between"><span>Dog’s name</span><input value={s.dogName} onChange={(e) => setSettings({ dogName: e.target.value })} /></label>
      <label className="row between"><span>Session</span><span><input type="number" value={s.sessionMin} onChange={num('sessionMin', 5, 180)} /> min, then <input type="number" value={s.restMin} onChange={num('restMin', 0, 600)} /> rest</span></label>
      <label className="row between"><span>Quiet hours</span><span><input type="checkbox" checked={s.quietOn} onChange={bool('quietOn')} /> <input type="time" value={s.quietStart} onChange={(e) => setSettings({ quietStart: e.target.value })} />–<input type="time" value={s.quietEnd} onChange={(e) => setSettings({ quietEnd: e.target.value })} /></span></label>
      <label className="row between"><span>Volume cap</span><input type="range" min={0} max={1} step={0.05} value={s.volumeCap} onChange={(e) => setSettings({ volumeCap: Number(e.target.value) })} /></label>
      <label className="row between"><span>Rotate after low attention</span><span><input type="number" value={s.rotateAfterSec} onChange={num('rotateAfterSec', 15, 600)} /> s</span></label>
      <label className="row between"><span>Only play bundled clips (no YouTube, no ads)</span><input type="checkbox" checked={s.fileOnly} onChange={bool('fileOnly')} /></label>
      <hr />
      <p className="muted small">Experimental</p>
      <label className="row between"><span>Nose cursor</span><input type="checkbox" checked={s.noseCursor} onChange={bool('noseCursor')} /></label>
      <button className="row link" onClick={() => go('calibrate')}><span>Calibrate nose</span><span>→</span></button>
      <label className="row between"><span>Pick screen (dog chooses between two)</span><input type="checkbox" checked={s.pickScreen} onChange={bool('pickScreen')} /></label>
      <hr />
      <button className="row link" onClick={() => setAdv((v) => !v)}><span>Advanced</span><span>{adv ? '▾' : '→'}</span></button>
      {adv && (
        <div className="adv">
          <label className="row between"><span>Recording</span>
            <select value={s.recordMode} onChange={(e) => setSettings({ recordMode: e.target.value as Settings['recordMode'] })}>
              <option value="auto">Auto (snippets once tracking works)</option><option value="full">Whole session</option><option value="snippets">Smart snippets</option>
            </select></label>
          <label className="row between"><span>Record sound (the microphone hears your home)</span><input type="checkbox" checked={s.recordAudio} onChange={bool('recordAudio')} /></label>
          <label className="row between"><span>Clip storage cap</span><span><input type="number" value={s.storageCapMB} onChange={num('storageCapMB', 50, 4000)} /> MB</span></label>
          <label className="row between"><span>Mount note (saved with clips)</span><input value={s.mountNote} placeholder="floor stand, living room" onChange={(e) => setSettings({ mountNote: e.target.value })} /></label>
          <label className="row between"><span>Dev mode</span><input type="checkbox" checked={s.devMode} onChange={bool('devMode')} /></label>
          {s.devMode && (
            <>
              <label className="row between"><span>Show HUD and nose dot in dog mode</span><input type="checkbox" checked={s.showHud} onChange={bool('showHud')} /></label>
              <label className="row between"><span>Use a video file as the camera</span><input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void startFileCamera(f).then(() => senses.start()) }} /></label>
            </>
          )}
          <p className="muted small">{usage}. Tracking model: {senses.state.model}. Everything stays on this device; clips leave only when you share them.</p>
          <button className="row link" onClick={() => setSettings({ wizardDone: false })}><span>Run setup again</span><span>→</span></button>
        </div>
      )}
    </div>
  )
}
