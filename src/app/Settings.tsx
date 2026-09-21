import { setSettings, useSettings, type Settings } from '../store/settings'

/** Deliberately short. Everything else runs on defaults. */
export function SettingsScreen() {
  const s = useSettings()
  const bool = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ [k]: e.target.checked } as Partial<Settings>)
  return (
    <div className="settings">
      <h2>Settings</h2>
      <label className="row between"><span>Volume limit</span><input type="range" min={0} max={1} step={0.05} value={s.volumeCap} onChange={(e) => setSettings({ volumeCap: Number(e.target.value) })} /></label>
      <label className="row between"><span>Record sessions for training<small>Clips stay on this device until you share them.</small></span><input type="checkbox" checked={s.record} onChange={bool('record')} /></label>
      <label className="row between"><span>Show the pointer to the dog<small>Turn off if the dog starts chasing it.</small></span><input type="checkbox" checked={s.showCursor} onChange={bool('showCursor')} /></label>
      <label className="row between"><span>Attention monitor<small>Live camera and attention readout, top right, while testing.</small></span><input type="checkbox" checked={s.showMonitor} onChange={bool('showMonitor')} /></label>
      <label className="row between"><span>No YouTube<small>Only the bundled clips. No ads, but only five videos.</small></span><input type="checkbox" checked={s.fileOnly} onChange={bool('fileOnly')} /></label>
    </div>
  )
}
