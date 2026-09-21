import { useEffect, useState } from 'react'
import { listClips, type ClipRow } from '../recorder/clipStore'
import { recorder } from '../recorder/recorder'
import { shareSink } from '../recorder/share'
import { playsSince, today0, type PlayRecord } from '../store/db'
import type { Preset } from '../store/settings'

const CHANNELS: { id: Preset; name: string; blurb: string }[] = [
  { id: 'calm', name: 'Calm', blurb: 'Forests, rain, fish, nature sounds' },
  { id: 'birds', name: 'Bird TV', blurb: 'Birds and squirrels, with game breaks' },
  { id: 'games', name: 'Games', blurb: 'Bop the critter, chase the ball' },
  { id: 'everything', name: 'Everything', blurb: 'All of it. Learns what holds attention' },
]
const TAG_WORDS: Record<string, string> = { 'nature-sounds': 'Nature sounds', 'trees-forest': 'Forests', birds: 'Birds', squirrels: 'Squirrels', 'dogs-playing': 'Other dogs', 'fish-tank': 'Fish', rain: 'Rain', farm: 'Farm animals', game: 'Games' }

/** One line built from the log by template, not by a model. Null until there is something to say. */
export function summarize(plays: PlayRecord[]): string | null {
  const mins = Math.round(plays.reduce((s, p) => s + p.durSec, 0) / 60)
  if (mins < 1) return null
  const byTag = new Map<string, { w: number; att: number }>()
  for (const p of plays) { const t = byTag.get(p.tag) ?? { w: 0, att: 0 }; t.w += p.durSec; t.att += p.meanAttention * p.durSec; byTag.set(p.tag, t) }
  const best = [...byTag.entries()].filter(([, v]) => v.w > 60).map(([tag, v]) => ({ tag, att: v.att / v.w })).sort((a, b) => b.att - a.att)[0]
  return `${mins} min today.` + (best && best.att > 0.05 ? ` ${TAG_WORDS[best.tag] ?? best.tag} held attention longest.` : '')
}

/** The front page is a channel picker: tapping a channel starts it. */
export function Today({ onStart }: { onStart: (channel: Preset) => void }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [fresh, setFresh] = useState<ClipRow[]>([])
  const [note, setNote] = useState('')
  const refresh = () => listClips().then((c) => setFresh(c.filter((x) => !x.shared)))
  useEffect(() => {
    void playsSince(today0()).then((p) => setSummary(summarize(p))); void refresh()
    // the last clip of a session finishes saving a moment after dog mode closes
    recorder.onSaved = () => { void refresh(); void playsSince(today0()).then((p) => setSummary(summarize(p))) }
    return () => { recorder.onSaved = null }
  }, [])

  const share = async () => {
    setNote('Preparing…')
    try { const r = await shareSink.send(fresh); setNote(r === 'cancelled' ? '' : r === 'shared' ? 'Shared.' : 'Saved to Downloads.') } catch (e) { setNote('Could not share: ' + (e as Error).message) }
    void refresh()
  }
  return (
    <div className="home">
      <div className="channels">
        {CHANNELS.map((c) => (
          <button key={c.id} className={`channel ch-${c.id}`} onClick={() => onStart(c.id)}>
            <strong>{c.name}</strong><span>{c.blurb}</span>
          </button>
        ))}
      </div>
      {summary && <p className="muted home-line">{summary}</p>}
      {fresh.length > 0 && (
        <button className="share-banner" onClick={share}>
          <span>{fresh.length} new training clip{fresh.length > 1 ? 's' : ''} · {Math.round(fresh.reduce((s, c) => s + c.bytes, 0) / 1e6)} MB</span><strong>Share</strong>
        </button>
      )}
      {note && <p className="note">{note}</p>}
    </div>
  )
}
