import { useEffect, useState } from 'react'
import { loadCatalog } from '../content/catalog'
import { listClips } from '../recorder/clipStore'
import { startCamera, stopCamera } from '../sensing/camera'
import { senses } from '../sensing/senses'
import { playsSince, today0, type PlayRecord } from '../store/db'
import { setSettings, useSettings, type Preset } from '../store/settings'
import type { Screen } from './App'

const PRESETS: [Preset, string][] = [['calm', 'calm mix'], ['birds', 'bird TV'], ['games', 'games heavy'], ['everything', 'everything']]
const TAG_WORDS: Record<string, string> = { 'nature-sounds': 'Nature sounds', 'trees-forest': 'Forests', birds: 'Birds', squirrels: 'Squirrels', 'dogs-playing': 'Other dogs', 'fish-tank': 'Fish', rain: 'Rain', farm: 'Farm animals', game: 'Games' }

/** The dashboard sentence is a template over the log, not a model. */
export function summarize(name: string, plays: PlayRecord[]): { line1: string; line2: string } {
  const mins = Math.round(plays.reduce((s, p) => s + p.durSec, 0) / 60)
  if (!plays.length || mins < 1) return { line1: `${name} hasn't had a session today.`, line2: 'Start one below.' }
  const byTag = new Map<string, { w: number; att: number }>()
  for (const p of plays) { const t = byTag.get(p.tag) ?? { w: 0, att: 0 }; t.w += p.durSec; t.att += p.meanAttention * p.durSec; byTag.set(p.tag, t) }
  const ranked = [...byTag.entries()].filter(([, v]) => v.w > 60).map(([tag, v]) => ({ tag, att: v.att / v.w })).sort((a, b) => b.att - a.att)
  const worked = plays.reduce((s, p) => s + p.workedUpSec, 0)
  const best = ranked[0]
  let line2 = best && best.att > 0.05 ? `${TAG_WORDS[best.tag] ?? best.tag} held attention longest.` : 'Not enough attention data yet.'
  if (worked > 120) line2 += ` Worked up for ${Math.round(worked / 60)} min.`
  return { line1: `${name} watched ${mins} min today.`, line2 }
}

export function Today({ onStart, go }: { onStart: () => void; go: (s: Screen) => void }) {
  const s = useSettings()
  const [plays, setPlays] = useState<PlayRecord[]>([])
  const [clips, setClips] = useState({ fresh: 0, mb: 0 })
  const [cam, setCam] = useState<'checking' | 'dog' | 'no-dog' | 'no-model' | 'denied'>('checking')
  const [count, setCount] = useState(0)

  useEffect(() => {
    void playsSince(today0()).then(setPlays)
    void listClips().then((c) => setClips({ fresh: c.filter((x) => !x.shared).length, mb: Math.round(c.reduce((a, x) => a + x.bytes, 0) / 1e6) }))
    void loadCatalog().then((c) => setCount(c.length))
    // live check, so a session never starts with a camera that can't see
    let off = () => {}
    startCamera().then(() => {
      senses.start(); senses.setFps(2)
      off = senses.subscribe((st) => setCam(st.model === 'unavailable' ? 'no-model' : st.model === 'loading' ? 'checking' : st.hasDog ? 'dog' : 'no-dog'))
    }).catch(() => setCam('denied'))
    return () => { off(); senses.stop(); stopCamera() }
  }, [])

  const { line1, line2 } = summarize(s.dogName, plays)
  const spark = sparkline(plays)
  const camText = { checking: 'Checking the camera…', dog: 'Camera sees a dog', 'no-dog': 'Camera on, no dog in view', 'no-model': 'Camera on. Dog tracking model not installed yet', denied: 'Camera blocked. Allow it in site settings' }[cam]
  return (
    <div className="today">
      <h1>{line1}</h1>
      <p className="lead">{line2}</p>
      {spark && <div className="spark" aria-label="attention through the day">{spark}<span> attention</span></div>}
      <button className="start" onClick={onStart}>▶ Start session</button>
      <div className="row">
        <span>{s.sessionMin} min ·</span>
        <select value={s.preset} onChange={(e) => setSettings({ preset: e.target.value as Preset })}>{PRESETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
        <span className="muted">{count} videos</span>
      </div>
      <label className="row toggle"><span>◉ Record for training</span><input type="checkbox" checked={s.record} onChange={(e) => setSettings({ record: e.target.checked })} /></label>
      <div className={`row cam cam-${cam}`}><span className="dot" />{camText}</div>
      <button className="row link" onClick={() => go('clips')}><span>Clips: {clips.fresh} new · {clips.mb} MB</span><span>→</span></button>
    </div>
  )
}

function sparkline(plays: PlayRecord[]): string | null {
  const vids = plays.filter((p) => p.kind === 'video' && p.durSec > 20)
  if (vids.length < 3) return null
  const bars = '▁▂▃▄▅▆▇█'
  return vids.slice(-24).map((p) => bars[Math.min(7, Math.floor(p.meanAttention * 8))]).join('')
}
