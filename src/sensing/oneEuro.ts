// One Euro filter (Casiez et al.): low jitter when still, low lag when moving.
class LowPass {
  private y: number | null = null
  filter(x: number, a: number) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y }
  get last() { return this.y }
}
const alpha = (cutoff: number, dt: number) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt) }

export class OneEuro {
  private x = new LowPass(); private dx = new LowPass(); private tPrev: number | null = null
  constructor(private minCutoff = 1.0, private beta = 0.02, private dCutoff = 1.0) {}
  filter(v: number, tSec: number): number {
    const dt = this.tPrev === null ? 1 / 30 : Math.max(1e-3, tSec - this.tPrev)
    this.tPrev = tSec
    const prev = this.x.last
    const dv = prev === null ? 0 : (v - prev) / dt
    const edv = this.dx.filter(dv, alpha(this.dCutoff, dt))
    return this.x.filter(v, alpha(this.minCutoff + this.beta * Math.abs(edv), dt))
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null }
}
