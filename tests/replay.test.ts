// Replays recorded clip timelines through the old and new pointer smoothing to compare them on real data.
//   REPLAY_DIR=/path/with/clip-jsons npx vitest run tests/replay.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OneEuro } from '../src/sensing/oneEuro'
import { PointerFilter } from '../src/sensing/pointerFilter'

const dir = process.env.REPLAY_DIR
const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN)

describe.skipIf(!dir)('pointer replay', () => {
  it('new filter moves less between frames and drops out less', () => {
    for (const f of readdirSync(dir!).filter((n) => n.endsWith('.json'))) {
      const poses = JSON.parse(readFileSync(join(dir!, f), 'utf8')).timeline.filter((e: { type: string }) => e.type === 'pose')
      const run = (kind: 'old' | 'new') => {
        const fx = new OneEuro(1.2, 0.05), pf = new PointerFilter()
        const out: (number | null)[] = []
        for (const e of poses) {
          let raw: { x: number; y: number } | null = e.raw ? { x: e.raw[0], y: e.raw[1] } : null
          if (kind === 'old') { if (!raw) { fx.reset(); out.push(null) } else out.push(fx.filter(raw.x, e.t / 1000)); continue }
          if (raw && e.yawUsed) raw = { x: Math.max(0, Math.min(1, raw.x - 0.25 * Math.max(-0.6, Math.min(0.6, e.yaw - e.neutral)))), y: raw.y }
          out.push(pf.update(raw, e.t)?.x ?? null)
        }
        const steps = out.slice(1).map((v, i) => (v !== null && out[i] !== null ? Math.abs(v - out[i]!) : null)).filter((v): v is number => v !== null)
        const drops = out.slice(1).filter((v, i) => v === null && out[i] !== null).length
        return { p50: q(steps, 0.5) * 100, p90: q(steps, 0.9) * 100, shown: out.filter((v) => v !== null).length / out.length, drops }
      }
      const a = run('old'), b = run('new')
      console.log(`${f.slice(6, 25)}  old: step p50 ${a.p50.toFixed(1)} p90 ${a.p90.toFixed(1)} shown ${(a.shown * 100).toFixed(0)}% drops ${a.drops}   new: step p50 ${b.p50.toFixed(1)} p90 ${b.p90.toFixed(1)} shown ${(b.shown * 100).toFixed(0)}% drops ${b.drops}`)
      expect(b.p90).toBeLessThanOrEqual(a.p90)
    }
  })
})
