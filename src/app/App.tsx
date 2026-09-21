import { useState } from 'react'
import { unlockAudio } from '../audio/sounds'
import { setSettings, useSettings, type Preset } from '../store/settings'
import { Clips } from './Clips'
import { DogMode } from './DogMode'
import { Library } from './Library'
import { PointerTest } from './PointerTest'
import { SettingsScreen } from './Settings'
import { Today } from './Today'
import { Wizard } from './Wizard'
import { enterKiosk } from './kiosk'

type Screen = 'watch' | 'library' | 'clips' | 'settings'
type Full = null | 'dog' | 'pointer-test'
const TABS: [Screen, string][] = [['watch', 'Watch'], ['library', 'Library'], ['clips', 'Clips'], ['settings', 'Settings']]

export function App() {
  const settings = useSettings()
  const [screen, setScreen] = useState<Screen>('watch')
  // diagnostics stay reachable without cluttering the UI: open the app at #pointer-test
  const [full, setFull] = useState<Full>(location.hash === '#pointer-test' ? 'pointer-test' : null)
  const [session, setSession] = useState(0)

  if (!settings.wizardDone) return <Wizard />
  if (full === 'dog') return <DogMode key={session} onExit={() => setFull(null)} />
  if (full === 'pointer-test') return <PointerTest onExit={() => { history.replaceState(null, '', location.pathname); setFull(null) }} />

  // fullscreen and audio have to be requested inside the tap itself
  const start = (channel: Preset) => { unlockAudio(); void enterKiosk(); setSettings({ preset: channel }); setSession((n) => n + 1); setFull('dog') }
  return (
    <div className="owner">
      <main className="owner-main">
        {screen === 'watch' && <Today onStart={start} />}
        {screen === 'library' && <Library />}
        {screen === 'clips' && <Clips />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, label]) => <button key={id} className={screen === id ? 'on' : ''} onClick={() => setScreen(id)}>{label}</button>)}
      </nav>
    </div>
  )
}
