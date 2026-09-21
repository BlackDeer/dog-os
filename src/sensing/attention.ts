import { KP, type Arousal, type DogPose, type Presence } from './types'

export interface AttentionFeatures {
  visible: number      // 0..1 how confidently nose + both eyes are seen
  yaw: number          // signed nose offset between the eyes, in eye-distance units (0 = nose centered)
  roll: number         // |eye line tilt| in radians
  proximity: number    // eye distance as a fraction of frame width
  motion: number       // mean keypoint displacement since last frame, in eye-distance units per second
  ref: 'eyes' | 'ears' // which pair served as the head's left/right reference
}

export interface AttentionWeights { yawTol: number; rollTol: number; proxLo: number; proxHi: number; motionTol: number }
export const DEFAULT_WEIGHTS: AttentionWeights = { yawTol: 0.45, rollTol: 0.6, proxLo: 0.03, proxHi: 0.12, motionTol: 1.5 }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const MIN_C = 0.35

export function features(pose: DogPose, prev: DogPose | null, dtSec: number): AttentionFeatures | null {
  const n = pose.kpts[KP.nose]
  let le = pose.kpts[KP.left_eye], re = pose.kpts[KP.right_eye]
  if (!n || !le || !re) return null
  let scale = 1, ref: 'eyes' | 'ears' = 'eyes'
  // Eyes are the weakest keypoints (only ~1k training images label them). When they drop out, the ear bases,
  // which are well supervised, stand in as the head's left/right reference; ears sit ~1.8× wider than eyes.
  const lb = pose.kpts[KP.left_ear_base], rb = pose.kpts[KP.right_ear_base]
  if (Math.min(le.c, re.c) < MIN_C && lb && rb && Math.min(lb.c, rb.c) >= MIN_C) { le = lb; re = rb; scale = 0.55; ref = 'ears' }
  const visible = Math.min(n.c, le.c, re.c)
  const ex = re.x - le.x, ey = re.y - le.y
  const eyeDist = Math.hypot(ex, ey) * scale
  // project nose onto the eye line; 0 at the midpoint, ±0.5 at either eye
  const mx = (le.x + re.x) / 2, my = (le.y + re.y) / 2
  const yaw = (((n.x - mx) * ex + (n.y - my) * ey) / (ex * ex + ey * ey)) / scale   // in eye-distance units, whichever pair was used
  let roll = Math.abs(Math.atan2(ey, ex))
  if (roll > Math.PI / 2) roll = Math.PI - roll   // left/right eye order depends on mirroring
  let motion = 0
  if (prev && dtSec > 0) {
    let sum = 0, cnt = 0
    for (const i of [KP.nose, KP.left_eye, KP.right_eye, KP.left_ear_base, KP.right_ear_base]) {
      const a = pose.kpts[i], b = prev.kpts[i]
      if (a.c > MIN_C && b.c > MIN_C) { sum += Math.hypot(a.x - b.x, a.y - b.y); cnt++ }
    }
    if (cnt) motion = sum / cnt / eyeDist / dtSec
  }
  return { visible, yaw, roll, proximity: eyeDist, motion, ref }
}

/** 0..1: how much the dog's head is oriented at the screen. `neutralYaw` is the learned resting offset. */
export function attentionScore(f: AttentionFeatures | null, neutralYaw = 0, w: AttentionWeights = DEFAULT_WEIGHTS): number {
  if (!f || f.visible < MIN_C) return 0
  const yawTerm = clamp01(1 - Math.abs(f.yaw - neutralYaw) / w.yawTol)
  const rollTerm = clamp01(1 - f.roll / w.rollTol)
  const proxTerm = clamp01((f.proximity - w.proxLo) / (w.proxHi - w.proxLo))
  const stillTerm = clamp01(1 - f.motion / w.motionTol)
  const vis = clamp01((f.visible - MIN_C) / (0.8 - MIN_C))
  return clamp01(vis * yawTerm * (0.6 + 0.4 * rollTerm) * (0.5 + 0.5 * proxTerm) * (0.7 + 0.3 * stillTerm))
}

export class Ema {
  value = 0; private init = false
  constructor(private tauSec: number) {}
  update(v: number, dtSec: number) {
    if (!this.init) { this.value = v; this.init = true; return v }
    const a = 1 - Math.exp(-dtSec / this.tauSec)
    this.value += a * (v - this.value)
    return this.value
  }
}

/** Running median over a fixed window; used to learn the neutral yaw when uncalibrated. */
export class RunningMedian {
  private buf: number[] = []
  constructor(private size = 200) {}
  push(v: number) { this.buf.push(v); if (this.buf.length > this.size) this.buf.shift() }
  get value() { if (!this.buf.length) return 0; const s = [...this.buf].sort((a, b) => a - b); return s[s.length >> 1] }
  get count() { return this.buf.length }
}

/** Motion energy over a window → calm | alert | worked-up. */
export class ArousalTracker {
  private samples: { t: number; m: number }[] = []
  constructor(private windowSec = 5, private alertAt = 0.8, private workedUpAt = 2.2) {}
  update(motion: number, tSec: number): Arousal {
    this.samples.push({ t: tSec, m: motion })
    while (this.samples.length && tSec - this.samples[0].t > this.windowSec) this.samples.shift()
    return this.state
  }
  get energy() { return this.samples.length ? this.samples.reduce((s, x) => s + x.m, 0) / this.samples.length : 0 }
  get state(): Arousal { const e = this.energy; return e >= this.workedUpAt ? 'worked-up' : e >= this.alertAt ? 'alert' : 'calm' }
}

export function presence(hasDog: boolean, attention: number, msSinceTouch: number, attendAt = 0.45): Presence {
  if (msSinceTouch < 4000) return 'touching'   // a touch proves the dog is here even if the face left the frame
  if (!hasDog) return 'absent'
  return attention >= attendAt ? 'attending' : 'present'
}

/** Reward the bandit learns from: attention, discounted when the dog is wound up. */
export function reward(attention: number, arousal: Arousal): number {
  return attention * (arousal === 'worked-up' ? 0.2 : arousal === 'alert' ? 0.85 : 1)
}
