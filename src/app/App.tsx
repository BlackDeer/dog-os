import { useEffect, useState } from 'react'
import { unlockAudio } from '../audio/sounds'
import { useSettings } from '../store/settings'
import { Calibrate } from './Calibrate'
import { Clips } from './Clips'
import { DogMode } from './DogMode'
import { Library } from './Library'
import { SettingsScreen } from './Settings'
import { Today } from './Today'
import { TouchTarget, Train } from './Train'
import { Wizard } from './Wizard'
import { enterKiosk, exitKiosk } from './kiosk'

export type Screen = 'today' | 'train' | 'library' | 'settings' | 'clips' | 'calibrate'
type Full = null | 'dog' | 'countdown' | 'touch-target'

export function App() {
  const settings = useSettings()
  const [screen, setScreen] = useState<Screen>('today')
  const [full, setFull] = useState<Full>(null)

  if (!settings.wizardDone) return <Wizard />
  if (full === 'dog') return <DogMode onExit={() => setFull(null)} />
  if (full === 'touch-target') return <TouchTarget onExit={() => setFull(null)} />
  if (full === 'countdown') return <Countdown onDone={() => setFull('dog')} onCancel={() => { void exitKiosk(); setFull(null) }} />

  const tabs: [Screen, string][] = [['today', 'Today'], ['train', 'Train'], ['library', 'Library'], ['settings', '⚙']]
  return (
    <div className="owner">
      <main className="owner-main">
        {screen === 'today' && <Today onStart={() => { unlockAudio(); void enterKiosk(); setFull('countdown') }} go={setScreen} />}
        {screen === 'train' && <Train onTouchTarget={() => { unlockAudio(); void enterKiosk(); setFull('touch-target') }} />}
        {screen === 'library' && <Library />}
        {screen === 'settings' && <SettingsScreen go={setScreen} />}
        {screen === 'clips' && <Clips back={() => setScreen('today')} />}
        {screen === 'calibrate' && <Calibrate back={() => setScreen('settings')} />}
      </main>
      <nav className="tabs">
        {tabs.map(([id, label]) => <button key={id} className={screen === id ? 'on' : ''} onClick={() => setScreen(id)} aria-label={id}>{label}</button>)}
      </nav>
    </div>
  )
}

function Countdown({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [n, setN] = useState(5)
  useEffect(() => {
    if (n <= 0) { onDone(); return }
    const t = setTimeout(() => setN((v) => v - 1), 1000)
    return () => clearTimeout(t)
  }, [n])
  return (
    <div className="countdown" onClick={onCancel}>
      <div className="countdown-n">{Math.max(n, 1)}</div>
      <p>Put the phone in the stand.</p>
      <p className="muted">Tap to cancel. To come back: hold the top-right corner for 3 seconds.</p>
    </div>
  )
}
