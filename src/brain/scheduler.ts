// The one state machine: resting → watching → (picking) → gaming → watching → resting.
// Pure: time and sensing come in, actions come out. No timers, no DOM.
import type { Arousal, Presence } from '../sensing/types'

export type Mode = 'rest' | 'watch' | 'pick' | 'play'
export type Action =
  | { type: 'enter'; mode: Mode; reason: string }
  | { type: 'next-video'; reason: 'low-attention' | 'calm-down' | 'timer' | 'picked' | 'failed' | 'start'; calmOnly?: boolean }
  | { type: 'session-over' }

export interface SchedulerConfig {
  rotateAfterSec: number
  lowReward: number          // below this the dog isn't engaged
  absentToRestSec: number
  workedUpSec: number
  sessionSec: number
  cooldownSec: number
  gameMinGapSec: number
  gameMaxSec: number
  gameIdleSec: number
  pickSec: number
  pickEnabled: boolean
  blindRotateSec: number     // rotation period when no pose model is available
  gamesEnabled: boolean
}
export const DEFAULT_CONFIG: SchedulerConfig = {
  rotateAfterSec: 45, lowReward: 0.25, absentToRestSec: 300, workedUpSec: 8, sessionSec: 1800, cooldownSec: 3600,
  gameMinGapSec: 600, gameMaxSec: 240, gameIdleSec: 40, pickSec: 10, pickEnabled: false, blindRotateSec: 600, gamesEnabled: true,
}
export interface Input { now: number; presence: Presence; attention: number; reward: number; arousal: Arousal; sensing: boolean; quiet: boolean; lastInteraction: number }

export class Scheduler {
  mode: Mode = 'rest'
  private modeSince = 0
  private lowSince: number | null = null
  private absentSince: number | null = null
  private workedUpSince: number | null = null
  private activeSec = 0
  private lastNow: number | null = null
  private cooldownUntil = 0
  private lastGameEnd = -Infinity
  private peak = 0
  constructor(public cfg: SchedulerConfig = DEFAULT_CONFIG) {}

  get activeSeconds() { return this.activeSec }
  get coolingDown() { return this.lastNow !== null && this.lastNow < this.cooldownUntil }
  private enter(mode: Mode, now: number, reason: string, out: Action[]) {
    if (this.mode === 'play') this.lastGameEnd = now
    this.mode = mode; this.modeSince = now; this.lowSince = null; this.workedUpSince = null; this.peak = 0
    out.push({ type: 'enter', mode, reason })
  }

  step(i: Input): Action[] {
    const out: Action[] = []
    const dt = this.lastNow === null ? 0 : Math.min(5, (i.now - this.lastNow) / 1000)
    this.lastNow = i.now
    const here = i.presence !== 'absent'
    const inMode = (i.now - this.modeSince) / 1000
    if (this.mode !== 'rest' && here) this.activeSec += dt
    this.absentSince = here ? null : (this.absentSince ?? i.now)
    const absentSec = this.absentSince === null ? 0 : (i.now - this.absentSince) / 1000

    if (this.mode === 'rest') {
      const blocked = i.quiet || i.now < this.cooldownUntil
      // with no pose model we can't see the dog: run whenever allowed
      if (!blocked && (here || !i.sensing)) { this.enter('watch', i.now, 'dog-arrived', out); out.push({ type: 'next-video', reason: 'start' }) }
      return out
    }

    if (i.quiet) { this.enter('rest', i.now, 'quiet-hours', out); return out }
    if (this.activeSec >= this.cfg.sessionSec) {
      this.activeSec = 0; this.cooldownUntil = i.now + this.cfg.cooldownSec * 1000
      out.push({ type: 'session-over' }); this.enter('rest', i.now, 'session-limit', out); return out
    }
    if (i.sensing && absentSec >= this.cfg.absentToRestSec) { this.enter('rest', i.now, 'dog-left', out); return out }

    if (this.mode === 'pick') {
      if (inMode >= this.cfg.pickSec) { this.enter('watch', i.now, 'pick-timeout', out); out.push({ type: 'next-video', reason: 'timer' }) }
      return out
    }

    if (this.mode === 'play') {
      const idle = (i.now - Math.max(i.lastInteraction, this.modeSince)) / 1000
      if (inMode >= this.cfg.gameMaxSec || idle >= this.cfg.gameIdleSec) { this.enter('watch', i.now, idle >= this.cfg.gameIdleSec ? 'game-idle' : 'game-done', out); out.push({ type: 'next-video', reason: 'timer' }) }
      return out
    }

    // watch
    if (!i.sensing) {
      if (inMode >= this.cfg.blindRotateSec) { this.modeSince = i.now; out.push({ type: 'next-video', reason: 'timer' }) }
      return out
    }
    this.workedUpSince = i.arousal === 'worked-up' ? (this.workedUpSince ?? i.now) : null
    if (this.workedUpSince !== null && (i.now - this.workedUpSince) / 1000 >= this.cfg.workedUpSec) {
      this.workedUpSince = null; this.lowSince = null; this.modeSince = i.now; this.peak = 0
      out.push({ type: 'next-video', reason: 'calm-down', calmOnly: true }); return out
    }
    this.peak = Math.max(this.peak * 0.999, i.attention)
    this.lowSince = i.reward < this.cfg.lowReward ? (this.lowSince ?? i.now) : null
    // high-then-falling attention while the dog is still here → offer a game
    const falling = this.peak > 0.6 && i.attention < this.peak * 0.6 && i.attention >= this.cfg.lowReward * 0.6
    if (this.cfg.gamesEnabled && here && falling && inMode > 120 && (i.now - this.lastGameEnd) / 1000 >= this.cfg.gameMinGapSec) {
      this.enter('play', i.now, 'attention-falling', out); return out
    }
    if (this.lowSince !== null && (i.now - this.lowSince) / 1000 >= this.cfg.rotateAfterSec) {
      if (this.cfg.pickEnabled && here) { this.enter('pick', i.now, 'rotation', out); return out }
      this.lowSince = null; this.modeSince = i.now; this.peak = 0
      out.push({ type: 'next-video', reason: 'low-attention' })
    }
    return out
  }

  /** The dog (or the bandit on its behalf) chose on the PICK screen. */
  picked(now: number): Action[] { const out: Action[] = []; this.enter('watch', now, 'picked', out); return out }
  forceMode(mode: Mode, now: number): Action[] { const out: Action[] = []; this.enter(mode, now, 'forced', out); return out }
}
