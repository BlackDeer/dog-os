import { describe, expect, it } from 'vitest'
import { emptyBandit, mean, pick, sampleBeta, update, type Arm } from '../src/brain/bandit'
import { DEFAULT_CONFIG, Scheduler, type Input } from '../src/brain/scheduler'
import { centroid, cosine, decodeF16, encodeF16, normalize } from '../src/brain/similarity'
import { TouchGate, hitTest } from '../src/input/hitTest'
import { ArousalTracker, Ema, attentionScore, features, presence, reward } from '../src/sensing/attention'
import { decodePose, letterbox } from '../src/sensing/decode'
import { DEFAULT_CAL, ZoneTracker, noseToScreen, pointAt } from '../src/sensing/noseZones'
import type { DogPose } from '../src/sensing/types'
import { parseYouTubeId } from '../src/content/catalog'
import { evictionOrder, type ClipRow } from '../src/recorder/clipStore'
import { inQuietHours, DEFAULTS } from '../src/store/settings'
import { summarizeTarget } from '../src/app/PointerTest'

const rng = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }

describe('hit testing', () => {
  const targets = [{ id: 'a', x: 100, y: 100, r: 50 }, { id: 'b', x: 260, y: 100, r: 50 }]
  it('is generous: a near miss still hits', () => expect(hitTest(170, 100, targets)?.id).toBe('a'))
  it('picks the nearest when two are in range', () => expect(hitTest(200, 100, targets)?.id).toBe('b'))
  it('misses when far away', () => expect(hitTest(600, 600, targets)).toBeNull())
  it('collapses multi-touch to the first contact and debounces', () => {
    const g = new TouchGate(300)
    expect(g.down(1, 0)).toBe(true)
    expect(g.down(2, 10)).toBe(false)          // second paw pad while the first is down
    g.up(1); g.up(2)
    expect(g.down(3, 100)).toBe(false)         // within debounce
    g.up(3)
    expect(g.down(4, 500)).toBe(true)
  })
})

const pose = (nx: number, opts: { c?: number; eyeDist?: number; cx?: number } = {}): DogPose => {
  const c = opts.c ?? 0.9, d = opts.eyeDist ?? 0.1, cx = opts.cx ?? 0.5
  const k = (x: number, y: number) => ({ x, y, c })
  return { box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, score: 0.9, kpts: [k(cx + nx * d, 0.55), k(cx - d / 2, 0.45), k(cx + d / 2, 0.45), ...Array(7).fill(k(cx, 0.5))] }
}

describe('attention', () => {
  it('scores a head facing the lens higher than a turned head', () => {
    const facing = attentionScore(features(pose(0), null, 0.5)), turned = attentionScore(features(pose(0.4), null, 0.5))
    expect(facing).toBeGreaterThan(0.7); expect(turned).toBeLessThan(facing * 0.3)
  })
  it('uses the learned neutral yaw instead of assuming the lens is centered', () => {
    const f = features(pose(0.3), null, 0.5)
    expect(attentionScore(f, 0.3)).toBeGreaterThan(attentionScore(f, 0) * 2)
  })
  it('falls back to the ear bases when the eyes are not found', () => {
    const p = pose(0); p.kpts[1].c = 0.1; p.kpts[2].c = 0.1
    p.kpts[3] = { x: 0.5 - 0.09, y: 0.4, c: 0.9 }; p.kpts[4] = { x: 0.5 + 0.09, y: 0.4, c: 0.9 }
    const f = features(p, null, 0.5)!
    expect(f.visible).toBeGreaterThan(0.8); expect(f.proximity).toBeCloseTo(0.099, 2); expect(attentionScore(f)).toBeGreaterThan(0.6)
    const turned = pose(0.4); turned.kpts[1].c = 0.1; turned.kpts[2].c = 0.1; turned.kpts[3] = p.kpts[3]; turned.kpts[4] = p.kpts[4]
    expect(attentionScore(features(turned, null, 0.5))).toBeLessThan(0.2)
  })
  it('is zero when the face is not confidently visible', () => expect(attentionScore(features(pose(0, { c: 0.2 }), null, 0.5))).toBe(0))
  it('drops with distance', () => expect(attentionScore(features(pose(0, { eyeDist: 0.03 }), null, 0.5))).toBeLessThan(attentionScore(features(pose(0), null, 0.5))))
  it('measures motion between frames', () => expect(features(pose(0, { cx: 0.6 }), pose(0), 0.5)!.motion).toBeCloseTo(2, 1))
  it('EMA converges', () => { const e = new Ema(1); for (let i = 0; i < 50; i++) e.update(1, 0.2); expect(e.value).toBeGreaterThan(0.99) })
  it('flags sustained motion as worked-up and discounts its reward', () => {
    const a = new ArousalTracker(); let s = a.update(0, 0)
    for (let t = 0; t < 6; t += 0.5) s = a.update(3, t)
    expect(s).toBe('worked-up'); expect(reward(0.9, 'worked-up')).toBeLessThan(reward(0.9, 'calm') * 0.3)
  })
  it('treats a recent touch as presence even with no face in frame', () => {
    expect(presence(false, 0, 1000)).toBe('touching'); expect(presence(false, 0, 99999)).toBe('absent'); expect(presence(true, 0.8, 99999)).toBe('attending')
  })
})

describe('nose zones', () => {
  it('mirrors: a nose at image-right is at screen-left', () => {
    expect(noseToScreen(DEFAULT_CAL.xLeft, 0.5).x).toBeCloseTo(0, 5); expect(noseToScreen(DEFAULT_CAL.xRight, 0.5).x).toBeCloseTo(1, 5); expect(noseToScreen(0.5, 0.5).x).toBeCloseTo(0.5, 5)
  })
  it('a turned head pushes the pointer further the way it is turned, relative to neutral', () => {
    const straight = pointAt(0.5, 0.5, 0.1, 0.1).x, right = pointAt(0.5, 0.5, 0.5, 0.1).x, left = pointAt(0.5, 0.5, -0.3, 0.1).x
    expect(straight).toBeCloseTo(0.5); expect(right).toBeGreaterThan(0.65); expect(left).toBeLessThan(0.35)
    expect(pointAt(DEFAULT_CAL.xRight, 0.5, 2, 0).x).toBe(1)   // clamped to the screen
  })
  it('holds a zone through jitter at the boundary', () => {
    const z = new ZoneTracker(0.08)
    expect(z.update(0.30, 0.2, 0).col).toBe(0)
    expect(z.update(0.35, 0.2, 100).col).toBe(0)   // just over the line: hysteresis holds
    expect(z.update(0.50, 0.2, 200).col).toBe(1)
    expect(z.dwellMs(700)).toBe(500)
  })
})

describe('pose decoding', () => {
  const lb = letterbox(640, 480, 320)   // scale .5, padY 40
  it('decodes an end-to-end (NMS-free) head', () => {
    const W = 6 + 30, data = new Float32Array(2 * W)
    data.set([10, 50, 110, 150, 0.2, 0], 0)
    data.set([80, 60, 240, 260, 0.9, 0, 160, 160, 0.95], W)
    const p = decodePose(data, [1, 2, W], 10, lb)!
    expect(p.score).toBeCloseTo(0.9); expect(p.kpts[0].x).toBeCloseTo(0.5); expect(p.kpts[0].y).toBeCloseTo(0.5); expect(p.box.x).toBeCloseTo(0.25)
  })
  it('decodes a raw head and keeps the best anchor', () => {
    const C = 5 + 30, A = 3, data = new Float32Array(C * A), set = (c: number, a: number, v: number) => (data[c * A + a] = v)
    ;[[0, 100], [1, 100], [2, 40], [3, 40], [4, 0.5]].forEach(([c, v]) => set(c, 0, v))
    ;[[0, 160], [1, 160], [2, 160], [3, 200], [4, 0.8], [5, 160], [6, 160], [7, 0.9]].forEach(([c, v]) => set(c, 2, v))
    const p = decodePose(data, [1, C, A], 10, lb)!
    expect(p.score).toBeCloseTo(0.8); expect(p.kpts[0].x).toBeCloseTo(0.5); expect(p.box.w).toBeCloseTo(0.5)
  })
  it('returns null below the threshold and throws on unknown shapes', () => {
    expect(decodePose(new Float32Array(36), [1, 1, 36], 10, lb)).toBeNull()
    expect(() => decodePose(new Float32Array(10), [1, 10], 10, lb)).toThrow()
  })
})

describe('bandit', () => {
  const armsList: Arm[] = [{ id: 'forest', tags: ['trees-forest'] }, { id: 'sq', tags: ['squirrels'] }]
  it('beta samples stay in range with the right mean', () => {
    const r = rng(7); let s = 0
    for (let i = 0; i < 4000; i++) { const v = sampleBeta({ a: 3, b: 1 }, r); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); s += v }
    expect(s / 4000).toBeCloseTo(0.75, 1)
  })
  it('starts out preferring what Niles already likes', () => {
    const r = rng(3); let forest = 0
    for (let i = 0; i < 500; i++) if (pick(emptyBandit(), armsList, { rng: r, explore: 0 })!.id === 'forest') forest++
    expect(forest).toBeGreaterThan(300)
  })
  it('learns from rewards and weights short exposures less', () => {
    let s = emptyBandit({})
    for (let i = 0; i < 20; i++) { s = update(s, armsList[1], 0.9); s = update(s, armsList[0], 0.1) }
    expect(mean(s.tags.squirrels)).toBeGreaterThan(0.8); expect(mean(s.tags['trees-forest'])).toBeLessThan(0.2)
    const r = rng(5); let sq = 0
    for (let i = 0; i < 300; i++) if (pick(s, armsList, { rng: r, explore: 0 })!.id === 'sq') sq++
    expect(sq).toBeGreaterThan(270)
    const light = update(emptyBandit({}), armsList[0], 1, 0.1)
    expect(light.items.forest.a).toBeCloseTo(1.1)
  })
  it('explores, excludes recent picks, and honours preset weights', () => {
    const r = rng(11); let other = 0
    let s = emptyBandit({}); for (let i = 0; i < 30; i++) s = update(s, armsList[0], 1)
    for (let i = 0; i < 1000; i++) if (pick(s, armsList, { rng: r, explore: 0.15 })!.id === 'sq') other++
    expect(other).toBeGreaterThan(40)
    expect(pick(s, armsList, { rng: r, explore: 0, exclude: ['forest'] })!.id).toBe('sq')
    let forest = 0
    for (let i = 0; i < 300; i++) if (pick(emptyBandit({}), armsList, { rng: r, explore: 0, tagWeights: { squirrels: 0.05 } })!.id === 'forest') forest++
    expect(forest).toBeGreaterThan(220)   // the item term still lets a down-weighted tag through sometimes
  })
})

describe('scheduler', () => {
  const base: Input = { now: 0, presence: 'attending', attention: 0.8, reward: 0.8, arousal: 'calm', sensing: true, quiet: false, lastInteraction: 0 }
  const run = (s: Scheduler, from: number, to: number, patch: Partial<Input>, stepMs = 500) => {
    const acts = []
    for (let t = from; t <= to; t += stepMs) acts.push(...s.step({ ...base, ...patch, now: t, lastInteraction: patch.lastInteraction ?? 0 }))
    return acts
  }
  it('rests until a dog shows up, then starts a video', () => {
    const s = new Scheduler()
    expect(run(s, 0, 5000, { presence: 'absent' })).toEqual([])
    const a = run(s, 5500, 5500, {})
    expect(s.mode).toBe('watch'); expect(a.some((x) => x.type === 'next-video')).toBe(true)
  })
  it('rotates after sustained low attention, not before', () => {
    const s = new Scheduler({ ...DEFAULT_CONFIG, gamesEnabled: false }); run(s, 0, 0, {})
    expect(run(s, 500, 40_000, { attention: 0.1, reward: 0.1, presence: 'present' }).filter((x) => x.type === 'next-video')).toHaveLength(0)
    expect(run(s, 40_500, 47_000, { attention: 0.1, reward: 0.1, presence: 'present' }).filter((x) => x.type === 'next-video')).toHaveLength(1)
  })
  it('a moment of attention resets the rotation clock', () => {
    const s = new Scheduler({ ...DEFAULT_CONFIG, gamesEnabled: false }); run(s, 0, 0, {})
    run(s, 500, 30_000, { reward: 0.1, attention: 0.1 }); run(s, 30_500, 31_000, {})
    expect(run(s, 31_500, 60_000, { reward: 0.1, attention: 0.1 }).filter((x) => x.type === 'next-video')).toHaveLength(0)
  })
  it('switches to calm content when the dog is worked up', () => {
    const s = new Scheduler(); run(s, 0, 0, {})
    const a = run(s, 500, 10_000, { arousal: 'worked-up' })
    expect(a.find((x) => x.type === 'next-video')).toMatchObject({ reason: 'calm-down', calmOnly: true })
  })
  it('goes to rest when the dog leaves, and wakes when it returns', () => {
    const s = new Scheduler(); run(s, 0, 0, {})
    run(s, 500, 301_000, { presence: 'absent', attention: 0, reward: 0 }); expect(s.mode).toBe('rest')
    run(s, 301_500, 301_500, {}); expect(s.mode).toBe('watch')
  })
  it('offers a game when attention was high and is falling, then returns to watching', () => {
    const s = new Scheduler(); run(s, 0, 0, {})
    run(s, 500, 130_000, { attention: 0.85, reward: 0.85 })
    run(s, 130_500, 132_000, { attention: 0.3, reward: 0.3 }); expect(s.mode).toBe('play')
    run(s, 132_500, 180_000, { lastInteraction: 132_000 }); expect(s.mode).toBe('watch')   // 40 s idle
  })
  it('ends the session at the limit and cools down', () => {
    const s = new Scheduler({ ...DEFAULT_CONFIG, sessionSec: 60, cooldownSec: 120, gamesEnabled: false })
    const a = run(s, 0, 70_000, {}); expect(a.some((x) => x.type === 'session-over')).toBe(true); expect(s.mode).toBe('rest')
    run(s, 70_500, 150_000, {}); expect(s.mode).toBe('rest')
    run(s, 191_000, 192_000, {}); expect(s.mode).toBe('watch')
  })
  it('respects quiet hours', () => { const s = new Scheduler(); run(s, 0, 5000, { quiet: true }); expect(s.mode).toBe('rest') })
  it('with no pose model, plays anyway and rotates on a timer', () => {
    const s = new Scheduler({ ...DEFAULT_CONFIG, blindRotateSec: 60 })
    const a = run(s, 0, 125_000, { sensing: false, presence: 'absent', attention: 0, reward: 0 })
    expect(s.mode).toBe('watch'); expect(a.filter((x) => x.type === 'next-video')).toHaveLength(3)
  })
  it('PICK times out to the bandit', () => {
    const s = new Scheduler({ ...DEFAULT_CONFIG, pickEnabled: true, gamesEnabled: false }); run(s, 0, 0, {})
    run(s, 500, 46_000, { reward: 0.1, attention: 0.1, presence: 'present' }); expect(s.mode).toBe('pick')
    const a = run(s, 46_500, 57_000, { reward: 0.1, attention: 0.1, presence: 'present' }); expect(s.mode).toBe('watch'); expect(a.some((x) => x.type === 'next-video')).toBe(true)
  })
})

describe('similarity', () => {
  it('cosine and centroid', () => {
    const a = normalize(new Float32Array([1, 0])), b = normalize(new Float32Array([0, 1]))
    expect(cosine(a, a)).toBeCloseTo(1); expect(cosine(a, b)).toBeCloseTo(0); expect(cosine(centroid([a, b])!, a)).toBeCloseTo(Math.SQRT1_2)
  })
  it('float16 round-trips within tolerance', () => {
    const v = new Float32Array([0, 0.123, -0.5, 0.9999, -0.00031, 1]), back = decodeF16(encodeF16(v))
    v.forEach((x, i) => expect(back[i]).toBeCloseTo(x, 3))
  })
})

describe('pointer test', () => {
  it('separates steady error from shake and counts dropouts', () => {
    const mk = (x: number | null) => ({ ptr: x === null ? null : { x, y: 0.5 }, raw: x === null ? null : { x, y: 0.5 }, conf: 0.8, yawUsed: true, ref: 'eyes' })
    const r = summarizeTarget([0.5, 0.5], [mk(0.68), mk(0.72), mk(0.68), mk(0.72), mk(null)])
    expect(r.found).toBeCloseTo(0.8); expect(r.errX).toBeCloseTo(0.2); expect(r.errY).toBeCloseTo(0); expect(r.jitterX).toBeCloseTo(0.02)
  })
})

describe('misc', () => {
  it('parses YouTube links', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe('abcdefghijk')
    expect(parseYouTubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
    expect(parseYouTubeId('https://www.youtube.com/embed/abcdefghijk')).toBe('abcdefghijk')
    expect(parseYouTubeId('not a link')).toBeNull()
  })
  it('evicts shared clips first, then oldest, only down to the cap', () => {
    const row = (id: string, start: number, shared: boolean): ClipRow => ({ id, start, shared, bytes: 100, durSec: 1, trigger: '', mime: '', hasAudio: false })
    const rows = [row('new', 3, false), row('old', 1, false), row('sharedNew', 4, true), row('mid', 2, false)]
    expect(evictionOrder(rows, 250).map((r) => r.id)).toEqual(['sharedNew', 'old'])
    expect(evictionOrder(rows, 1000)).toEqual([])
  })
  it('quiet hours wrap past midnight', () => {
    const at = (h: number) => { const d = new Date(2026, 0, 1, h, 30); return inQuietHours(DEFAULTS, d) }
    expect(at(23)).toBe(true); expect(at(3)).toBe(true); expect(at(12)).toBe(false)
  })
})
