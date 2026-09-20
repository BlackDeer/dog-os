import { useEffect, useRef, useState } from 'react'
import { cameraVideo, startCamera, stopCamera } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { KP } from '../sensing/types'
import { setSettings, useSettings } from '../store/settings'

export function Wizard() {
  const s = useSettings()
  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')
  const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  const finish = () => setSettings({ wizardDone: true })
  return (
    <div className="wizard">
      <div className="cal-bar">{[0, 1, 2, 3].map((i) => <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
      {step === 0 && (
        <section>
          <h1>Dog OS</h1>
          <p>A screen for your dog: calm channels, simple games, and training tools for you.</p>
          <label className="row between"><span>Dog’s name</span><input value={s.dogName} onChange={(e) => setSettings({ dogName: e.target.value })} /></label>
          <p>The front camera watches for the dog so the app knows what holds attention. Video is processed on this device and never uploaded.</p>
          {err && <p className="note">{err}</p>}
          <button className="primary" onClick={() => startCamera().then(() => setStep(1)).catch(() => setErr('Camera permission was blocked. Allow it in the site settings, then try again.'))}>Allow camera</button>
          <button className="ghost" onClick={() => setStep(1)}>Skip, run without the camera</button>
        </section>
      )}
      {step === 1 && (
        <section>
          <h2>Make it dog-proof</h2>
          {!installed && <p><strong>1.</strong> Browser menu → <em>Add to Home screen</em> (or <em>Install app</em>), then open Dog OS from the icon so it runs full screen.</p>}
          <p><strong>{installed ? '1' : '2'}.</strong> Android: Settings → Security → <em>App pinning</em> → on. Then open Recents, tap the app icon, choose <em>Pin</em>. A pinned app can’t be left by a nose. To unpin, hold Back and Overview together.</p>
          <p><strong>{installed ? '2' : '3'}.</strong> Turn on Do Not Disturb so nothing pops up or pings.</p>
          <p className="muted">On a laptop or tablet, skip the pinning and use the browser’s full screen.</p>
          <button className="primary" onClick={() => setStep(2)}>Done</button>
        </section>
      )}
      {step === 2 && <MountCheck next={() => setStep(3)} />}
      {step === 3 && (
        <section>
          <h2>Ready</h2>
          <p>Start a session from the Today screen. To get out of dog mode, hold the <strong>top-right corner for 3 seconds</strong> and answer the sum.</p>
          <p>Turn on <em>Record for training</em> for the first few sessions. Those clips are what teach the tracker to see your dog, and they stay on the device until you share them.</p>
          <button className="primary" onClick={finish}>Go</button>
        </section>
      )}
    </div>
  )
}

function MountCheck({ next }: { next: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [st, setSt] = useState<SenseState>(senses.state)
  useEffect(() => {
    let off = () => {}, raf = 0
    startCamera().then(() => { senses.start(); senses.setFps(8); off = senses.subscribe(setSt) }).catch(() => {})
    const draw = () => {
      const c = canvas.current, v = cameraVideo()
      if (c && v && v.videoWidth) {
        c.width = v.videoWidth; c.height = v.videoHeight
        const g = c.getContext('2d')!
        g.save(); g.scale(-1, 1); g.drawImage(v, -c.width, 0); g.restore()   // mirrored, like a selfie preview
        const n = senses.state.pose?.kpts[KP.nose]
        if (n && n.c > 0.4) { g.fillStyle = '#ffd23f'; g.beginPath(); g.arc((1 - n.x) * c.width, n.y * c.height, c.width * 0.025, 0, 6.3); g.fill() }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); off(); senses.stop(); stopCamera() }
  }, [])
  return (
    <section>
      <h2>Mount it at dog eye height</h2>
      <p>Landscape, leaning back slightly, on a charger and out of direct sun. Put the camera edge on the side the dog usually approaches from.</p>
      <canvas ref={canvas} className="preview" />
      <p className="note">{st.model === 'unavailable' ? 'Dog tracking isn’t installed yet. The app still plays and records; tracking arrives with an update.' : st.model === 'loading' ? 'Loading the tracker…' : st.hasDog ? 'Dog found. The yellow dot should sit on the nose.' : 'No dog in view yet. That’s fine, you can continue.'}</p>
      <button className="primary" onClick={next}>Continue</button>
    </section>
  )
}
