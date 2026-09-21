import { OneEuro } from './oneEuro'

export interface Pt { x: number; y: number }

/**
 * Steadies the pointer. Three things the first field test showed were needed:
 *  - the model sometimes flips to a different reading of the face for a frame or two (a bead eye taken for the
 *    nose), which throws the point across the screen: a short median window drops those;
 *  - single-frame dropouts reset the smoother and made the pointer blink and re-snap: hold the last point briefly;
 *  - the remaining keypoint noise wants heavier smoothing than the first guess.
 */
export class PointerFilter {
  private win: { t: number; p: Pt }[] = []
  private fx: OneEuro; private fy: OneEuro
  private last: Pt | null = null
  private lastSeen = -Infinity
  constructor(private opts = { window: 5, windowMs: 800, holdMs: 600, minCutoff: 0.6, beta: 0.03 }) {
    this.fx = new OneEuro(opts.minCutoff, opts.beta); this.fy = new OneEuro(opts.minCutoff, opts.beta)
  }
  update(raw: Pt | null, tMs: number): Pt | null {
    if (!raw) {
      if (tMs - this.lastSeen <= this.opts.holdMs) return this.last
      this.reset(); return null
    }
    this.lastSeen = tMs
    this.win.push({ t: tMs, p: raw })
    this.win = this.win.filter((w) => tMs - w.t <= this.opts.windowMs).slice(-this.opts.window)
    const med = (k: 'x' | 'y') => { const s = this.win.map((w) => w.p[k]).sort((a, b) => a - b); return s[s.length >> 1] }
    this.last = { x: this.fx.filter(med('x'), tMs / 1000), y: this.fy.filter(med('y'), tMs / 1000) }
    return this.last
  }
  reset() { this.win = []; this.fx.reset(); this.fy.reset(); this.last = null }
}
