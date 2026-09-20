import { useEffect, useState } from 'react'
import { features } from '../sensing/attention'
import { startCamera, stopCamera } from '../sensing/camera'
import { DEFAULT_CAL } from '../sensing/noseZones'
import { senses, type SenseState } from '../sensing/senses'
import { KP } from '../sensing/types'
import { setSettings } from '../store/settings'

const STEPS = [['xLeft', 'left edge'], ['xCenter', 'center'], ['xRight', 'right edge']] as const

/** Hold a treat a forearm's length in front of each spot; tap when the dog is looking at it. */
export function Calibrate({ back }: { back: () => void }) {
  const [step, setStep] = useState(0)
  const [st, setSt] = useState<SenseState>(senses.state)
  const [got, setGot] = useState<{ x: number[]; y: number[]; yaw: number[] }>({ x: [], y: [], yaw: [] })
  useEffect(() => {
    let off = () => {}
    void startCamera().then(() => { senses.start(); senses.setFps(8); off = senses.subscribe(setSt) }).catch(() => {})
    return () => { off(); senses.stop(); stopCamera() }
  }, [])

  const nose = st.pose?.kpts[KP.nose]
  const ok = !!nose && nose.c > 0.5
  const capture = () => {
    if (!st.pose || !nose) return
    const f = features(st.pose, null, 0)
    const next = { x: [...got.x, nose.x], y: [...got.y, nose.y], yaw: [...got.yaw, f?.yaw ?? 0] }
    setGot(next)
    if (step < 2) return setStep(step + 1)
    const [xLeft, xCenter, xRight] = next.x
    // a usable calibration needs left and right on opposite sides of center
    if (Math.sign(xLeft - xCenter) === Math.sign(xRight - xCenter) || Math.abs(xLeft - xRight) < 0.08) { setGot({ x: [], y: [], yaw: [] }); setStep(0); alertSoft('Those three were too close together. Try again with the treat further apart.'); return }
    setSettings({ calibration: { xLeft, xCenter, xRight, yMid: next.y[1] }, neutralYaw: next.yaw[1] })
    senses.calibration = { xLeft, xCenter, xRight, yMid: next.y[1] }; senses.calibratedNeutralYaw = next.yaw[1]
    back()
  }
  const [soft, alertSoft] = useState('')
  return (
    <div className="calibrate">
      <header><button className="back" onClick={back}>‹ Settings</button><h2>Calibrate nose</h2></header>
      <p>Hold a treat about a forearm’s length in front of the <strong>{STEPS[step][1]}</strong> of the screen. When the dog is looking at it, tap Capture.</p>
      <div className="cal-bar">{STEPS.map(([k], i) => <span key={k} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
      <p className={ok ? 'note good-note' : 'note'}>{st.model === 'unavailable' ? 'The tracking model isn’t installed yet, so there is nothing to calibrate.' : ok ? `Nose found (${nose!.c.toFixed(2)})` : 'Looking for a nose…'}</p>
      {soft && <p className="note">{soft}</p>}
      <div className="two">
        <button onClick={() => { setSettings({ calibration: DEFAULT_CAL, neutralYaw: null }); back() }}>Reset to default</button>
        <button className="primary" disabled={!ok} onClick={capture}>Capture {step + 1}/3</button>
      </div>
    </div>
  )
}
