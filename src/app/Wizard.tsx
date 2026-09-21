import { useState } from 'react'
import { startCamera, stopCamera } from '../sensing/camera'
import { setSettings } from '../store/settings'

export function Wizard() {
  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')
  const next = () => { stopCamera(); setStep(1) }
  return (
    <div className="wizard">
      {step === 0 && (
        <section>
          <h1>Dog OS</h1>
          <p>A screen for your dog: channels to watch, simple games, and training tools for you.</p>
          <p>The front camera watches for the dog so the app learns what holds attention. Sessions are recorded as short clips to improve the tracking. Everything stays on this device unless you share it.</p>
          {err && <p className="note">{err}</p>}
          <button className="primary" onClick={() => startCamera().then(next).catch(() => setErr('Camera permission was blocked. Allow it in the site settings, then try again.'))}>Allow camera</button>
          <button className="ghost" onClick={next}>Run without the camera</button>
        </section>
      )}
      {step === 1 && (
        <section>
          <h2>Before you start</h2>
          <p>Pick a channel to start it. To get back out, <strong>hold the ✕ in the top-left corner</strong> (or press Esc).</p>
          <p>On a phone: add the app to the home screen, turn on Android’s <em>App pinning</em> so a nose can’t leave it, and mount it landscape at dog eye height, on a charger.</p>
          <button className="primary" onClick={() => setSettings({ wizardDone: true })}>Go</button>
        </section>
      )}
    </div>
  )
}
