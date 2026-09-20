// Thompson sampling over tags with a per-item bonus. Rewards are fractional in [0,1].
export interface Beta { a: number; b: number }
export interface BanditState { tags: Record<string, Beta>; items: Record<string, Beta> }
export interface Arm { id: string; tags: string[]; pinned?: boolean }
export type Rng = () => number

export const NILES_PRIORS: Record<string, Beta> = { 'nature-sounds': { a: 3, b: 1 }, 'trees-forest': { a: 3, b: 1 } }
export const emptyBandit = (priors: Record<string, Beta> = NILES_PRIORS): BanditState => ({ tags: structuredClone(priors), items: {} })

function gaussian(rng: Rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
function gamma(k: number, rng: Rng): number {   // Marsaglia–Tsang
  if (k < 1) return gamma(k + 1, rng) * Math.pow(rng() || 1e-12, 1 / k)
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do { x = gaussian(rng); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = rng() || 1e-12
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
  }
}
export function sampleBeta({ a, b }: Beta, rng: Rng): number { const x = gamma(a, rng), y = gamma(b, rng); return x / (x + y) }
export const mean = ({ a, b }: Beta) => a / (a + b)
const prior = (): Beta => ({ a: 1, b: 1 })

export interface PickOptions { rng?: Rng; explore?: number; tagWeights?: Record<string, number>; exclude?: string[]; exploreRank?: (arms: Arm[]) => Arm[] }

export function pick(state: BanditState, arms: Arm[], opts: PickOptions = {}): Arm | null {
  const rng = opts.rng ?? Math.random
  const pool = arms.filter((a) => !opts.exclude?.includes(a.id))
  const usable = pool.length ? pool : arms
  if (!usable.length) return null
  if (rng() < (opts.explore ?? 0.15)) {
    // forced exploration; optionally guided (e.g. "most similar to what held attention, not yet played")
    const ranked = opts.exploreRank?.(usable) ?? usable
    return opts.exploreRank ? ranked[0] : usable[Math.floor(rng() * usable.length)]
  }
  let best: Arm | null = null, bestScore = -Infinity
  for (const arm of usable) {
    let tagScore = 0
    for (const t of arm.tags) tagScore = Math.max(tagScore, sampleBeta(state.tags[t] ?? prior(), rng) * (opts.tagWeights?.[t] ?? 1))
    if (!arm.tags.length) tagScore = sampleBeta(prior(), rng)
    const itemScore = sampleBeta(state.items[arm.id] ?? prior(), rng)
    const score = 0.7 * tagScore + 0.3 * itemScore + (arm.pinned ? 0.15 : 0)
    if (score > bestScore) { bestScore = score; best = arm }
  }
  return best
}

/** weight = how much evidence this exposure carries (short exposures count less). */
export function update(state: BanditState, arm: Arm, reward: number, weight = 1): BanditState {
  const r = Math.max(0, Math.min(1, reward)), w = Math.max(0, Math.min(1, weight))
  const bump = (b: Beta | undefined): Beta => { const p = b ?? prior(); return { a: p.a + r * w, b: p.b + (1 - r) * w } }
  const tags = { ...state.tags }
  for (const t of arm.tags) tags[t] = bump(tags[t])
  return { tags, items: { ...state.items, [arm.id]: bump(state.items[arm.id]) } }
}

export const PRESET_WEIGHTS: Record<string, Record<string, number>> = {
  calm: { 'nature-sounds': 1.3, 'trees-forest': 1.3, rain: 1.2, 'fish-tank': 1.1, birds: 0.7, squirrels: 0.4, 'dogs-playing': 0.4, farm: 0.7, game: 0.5 },
  birds: { birds: 1.5, squirrels: 1.1, game: 0.6 },
  games: { game: 1.6 },
  everything: {},
}
