import { decodeF16 } from '../brain/similarity'
import { kvGet, kvSet } from '../store/db'

export interface Video {
  id: string; source: 'youtube' | 'file'; ref: string; title: string; channel?: string; tags: string[]
  durationSec?: number | null; calm?: boolean; license?: string; embedding?: Float32Array; custom?: boolean
  /** Openers lead a session: content picked for grabbing attention fast. `startAt` skips to where the action is. */
  opener?: boolean; startAt?: number | null; arousalRisk?: 'low' | 'medium' | 'high'
}
interface RawVideo extends Omit<Video, 'embedding'> { embedding?: string }
export interface Flags { pinned: string[]; blocked: string[]; failed: Record<string, number> }

export const TAGS = ['nature-sounds', 'trees-forest', 'birds', 'squirrels', 'dogs-playing', 'fish-tank', 'rain', 'farm']
const CALM_TAGS = new Set(['nature-sounds', 'trees-forest', 'rain', 'fish-tank'])
export const isCalm = (v: Video) => v.arousalRisk !== 'high' && (v.calm ?? v.tags.some((t) => CALM_TAGS.has(t)))

/**
 * The pool to draw from at this point in a session. The first `lead` picks come from openers when there are any;
 * the Calm channel only ever leads with low-arousal openers, because it promises calm, not excitement.
 */
export function sessionPool<T extends Pick<Video, 'opener' | 'arousalRisk'>>(all: T[], picksSoFar: number, channel: string, lead = 2): T[] {
  if (picksSoFar >= lead) return all
  const openers = all.filter((v) => v.opener && (channel !== 'calm' || (v.arousalRisk ?? 'low') === 'low'))
  return openers.length ? openers : all
}

let cache: Video[] | null = null
const hydrate = (r: RawVideo): Video => ({ ...r, embedding: r.embedding ? decodeF16(r.embedding) : undefined })

export async function loadCatalog(force = false): Promise<Video[]> {
  if (cache && !force) return cache
  let base: RawVideo[] = []
  try { base = (await (await fetch(import.meta.env.BASE_URL + 'catalog.json')).json()).videos ?? [] } catch { /* offline with no cache */ }
  const custom = await kvGet<RawVideo[]>('customVideos', [])
  cache = [...base, ...custom.map((c) => ({ ...c, custom: true }))].map(hydrate)
  return cache
}
export async function addCustomVideo(v: RawVideo) {
  const custom = await kvGet<RawVideo[]>('customVideos', [])
  await kvSet('customVideos', [...custom.filter((c) => c.id !== v.id), v]); cache = null
}
export async function removeCustomVideo(id: string) {
  await kvSet('customVideos', (await kvGet<RawVideo[]>('customVideos', [])).filter((c) => c.id !== id)); cache = null
}
export const getFlags = () => kvGet<Flags>('flags', { pinned: [], blocked: [], failed: {} })
export const setFlags = (f: Flags) => kvSet('flags', f)

export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v'); if (v) return v
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/); if (m) return m[1]
    }
  } catch { /* not a URL */ }
  return null
}
/** noembed mirrors YouTube's oEmbed with CORS enabled; YouTube's own endpoint can't be called from a page. */
export async function verifyYouTube(id: string): Promise<{ title: string; channel: string } | null> {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`)
    const j = await r.json()
    return j?.title && !j.error ? { title: j.title, channel: j.author_name ?? '' } : null
  } catch { return null }
}
export const thumb = (v: Video) => (v.source === 'youtube' ? `https://i.ytimg.com/vi/${v.ref}/mqdefault.jpg` : null)
