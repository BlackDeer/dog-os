// Turns raw pose frames into what the rest of the app consumes: attention, arousal, presence, nose zone.
import { cameraVideo } from './camera'
import { ArousalTracker, Ema, RunningMedian, attentionScore, features, presence, reward } from './attention'
import { DEFAULT_CAL, ZoneTracker, pointAt, type NoseCalibration, type Zone } from './noseZones'
import { OneEuro } from './oneEuro'
import { getSettings } from '../store/settings'
import { KP, type Arousal, type DogPose, type Presence } from './types'

export interface SenseState {
  model: 'loading' | 'ready' | 'unavailable'
  modelNote: string
  hasDog: boolean
  pose: DogPose | null
  attention: number          // smoothed 0..1
  arousal: Arousal
  presence: Presence
  reward: number
  nose: { x: number; y: number } | null   // screen space 0..1
  zone: Zone | null
  zoneDwellMs: number
  noseConf: number
  fps: number
  inferMs: number
  yaw: number
  // diagnostics for tuning the pointer
  rawNose: { x: number; y: number } | null   // pointer before smoothing
  neutralYaw: number
  yawUsed: boolean
  ref: 'eyes' | 'ears' | null
  proximity: number
  t: number
}

const initial: SenseState = {
  model: 'loading', modelNote: '', hasDog: false, pose: null, attention: 0, arousal: 'calm', presence: 'absent',
  reward: 0, nose: null, zone: null, zoneDwellMs: 0, noseConf: 0, fps: 0, inferMs: 0, yaw: 0, rawNose: null, neutralYaw: 0, yawUsed: false, ref: null, proximity: 0, t: 0,
}

type Listener = (s: SenseState) => void

class Senses {
  state: SenseState = initial
  private worker: Worker | null = null
  private listeners = new Set<Listener>()
  private timer: number | null = null
  private targetFps = 2
  private prevPose: DogPose | null = null
  private prevT = 0
  private att = new Ema(2.5)
  private fpsEma = new Ema(3)
  private arousal = new ArousalTracker()
  private neutral = new RunningMedian(300)
  private zones = new ZoneTracker()
  private fx = new OneEuro(1.2, 0.05); private fy = new OneEuro(1.2, 0.05)
  private lastTouch = -Infinity
  private lastDogT = 0
  calibration: NoseCalibration = DEFAULT_CAL
  calibratedNeutralYaw: number | null = null

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit(patch: Partial<SenseState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l(this.state)) }

  start() {
    if (this.worker) return
    const cfg = getSettings()
    this.calibration = cfg.calibration; this.calibratedNeutralYaw = cfg.neutralYaw
    this.worker = new Worker(new URL('./poseWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => this.onMessage(e.data)
    this.worker.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href })
    this.schedule()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.worker?.terminate(); this.worker = null
    this.state = initial
  }

  setFps(fps: number) { this.targetFps = fps }
  noteTouch() { this.lastTouch = performance.now() }
  get msSinceDog() { return performance.now() - this.lastDogT }

  private schedule() {
    // back off when inference is slow (thermal throttling): never spend more than ~50% of the time inferring
    const minGap = this.state.inferMs * 2
    const gap = Math.max(1000 / this.targetFps, minGap)
    this.timer = window.setTimeout(() => { this.tick(); this.schedule() }, gap)
  }

  private async tick() {
    const v = cameraVideo()
    if (!this.worker || this.state.model !== 'ready' || !v || v.readyState < 2 || !v.videoWidth) {
      if (this.state.model !== 'ready') this.emit({ presence: presence(false, 0, performance.now() - this.lastTouch), t: performance.now() })
      return
    }
    try {
      const bitmap = await createImageBitmap(v, { resizeWidth: 320, resizeHeight: Math.round((320 * v.videoHeight) / v.videoWidth), resizeQuality: 'low' })
      this.worker.postMessage({ type: 'frame', bitmap, t: performance.now() }, [bitmap])
    } catch { /* frame not ready */ }
  }

  private onMessage(m: { type: string; pose?: DogPose | null; t?: number; inferMs?: number; reason?: string }) {
    if (m.type === 'ready') return this.emit({ model: 'ready', modelNote: '' })
    if (m.type === 'unavailable') return this.emit({ model: 'unavailable', modelNote: m.reason ?? '' })
    if (m.type !== 'pose') return
    const now = m.t ?? performance.now()
    const dt = this.prevT ? Math.max(0.01, (now - this.prevT) / 1000) : 0.5
    this.prevT = now
    const pose = m.pose ?? null
    let attRaw = 0, motion = 0, yaw = this.state.yaw, nose: SenseState['nose'] = null, noseConf = 0, neutralYaw = this.calibratedNeutralYaw ?? 0
    let rawNose: SenseState['rawNose'] = null, yawUsed = false, ref: SenseState['ref'] = null, proximity = 0
    if (pose) {
      this.lastDogT = performance.now()
      const f = features(pose, this.prevPose, dt)
      if (f) {
        motion = f.motion; yaw = f.yaw; ref = f.ref; proximity = f.proximity
        if (f.visible > 0.5 && f.motion < 0.5) this.neutral.push(f.yaw)
        // learned neutral is clamped: the lens is never far off-axis, so a dog that mostly looks away must not become "neutral"
        neutralYaw = this.calibratedNeutralYaw ?? (this.neutral.count > 30 ? Math.max(-0.25, Math.min(0.25, this.neutral.value)) : 0)
        attRaw = attentionScore(f, neutralYaw)
      }
      const n = pose.kpts[KP.nose]
      noseConf = n.c
      if (n.c > 0.4) {
        yawUsed = !!f && f.visible >= 0.35
        const s = pointAt(n.x, n.y, yawUsed ? yaw : neutralYaw, neutralYaw, this.calibration)
        rawNose = s
        nose = { x: this.fx.filter(s.x, now / 1000), y: this.fy.filter(s.y, now / 1000) }
        this.zones.update(nose.x, nose.y, now)
      }
    }
    if (!nose) { this.zones.clear(); this.fx.reset(); this.fy.reset() }
    this.prevPose = pose
    const attention = this.att.update(attRaw, dt)
    const arousal = this.arousal.update(pose ? motion : 0, now / 1000)
    this.emit({
      hasDog: !!pose, pose, attention, arousal, yaw, nose, noseConf, rawNose, neutralYaw, yawUsed, ref, proximity,
      presence: presence(!!pose, attention, performance.now() - this.lastTouch),
      reward: reward(attention, arousal),
      zone: this.zones.zone, zoneDwellMs: this.zones.dwellMs(now),
      fps: this.fpsEma.update(1 / dt, dt), inferMs: m.inferMs ?? 0, t: now,
    })
  }
}

export const senses = new Senses()
