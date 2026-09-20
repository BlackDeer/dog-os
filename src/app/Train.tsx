import { useEffect, useRef, useState } from 'react'
import { click, unlockAudio } from '../audio/sounds'
import { useDogTouch } from '../input/useDogTouch'
import { all, dayKey, put, type TrainingRecord } from '../store/db'
import { OwnerGate, inGateCorner } from './OwnerGate'
import { exitKiosk } from './kiosk'

const CUES: { id: string; tip: string }[] = [
  { id: 'Sit', tip: 'Lure up and back. Click the instant the rear touches down.' },
  { id: 'Down', tip: 'Lure from nose to floor. Click when elbows land.' },
  { id: 'Stay', tip: 'Click while still, before the break. Add one second at a time.' },
  { id: 'Touch', tip: 'Offer a flat hand. Click on nose contact. This one transfers to the screen.' },
  { id: 'Place', tip: 'Click for any paw on the mat, then for all four.' },
]

function streak(rows: TrainingRecord[]): number {
  const days = new Set(rows.filter((r) => r.reps > 0).map((r) => r.day))
  let n = 0
  for (const d = new Date(); days.has(dayKey(d)); d.setDate(d.getDate() - 1)) n++
  return n
}

export function Train({ onTouchTarget }: { onTouchTarget: () => void }) {
  const [i, setI] = useState(0)
  const [rows, setRows] = useState<TrainingRecord[]>([])
  const cue = CUES[i]
  const today = rows.find((r) => r.cue === cue.id && r.day === dayKey())
  useEffect(() => { void all<TrainingRecord>('training').then(setRows) }, [])

  const mark = async (good: boolean) => {
    const base = today ?? { cue: cue.id, day: dayKey(), reps: 0, misses: 0 }
    const next = { ...base, reps: base.reps + (good ? 1 : 0), misses: base.misses + (good ? 0 : 1) }
    const id = await put('training', next)
    setRows((r) => [...r.filter((x) => x !== today), { ...next, id: id as number }])
  }
  const sw = useRef(0)
  return (
    <div className="train">
      <div className="cue" onTouchStart={(e) => (sw.current = e.touches[0].clientX)} onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - sw.current; if (Math.abs(dx) > 50) setI((v) => (v + (dx < 0 ? 1 : CUES.length - 1)) % CUES.length) }}>
        <button onClick={() => setI((v) => (v + CUES.length - 1) % CUES.length)} aria-label="previous cue">‹</button>
        <div><h1>{cue.id.toUpperCase()}</h1><p className="muted">{cue.tip}</p></div>
        <button onClick={() => setI((v) => (v + 1) % CUES.length)} aria-label="next cue">›</button>
      </div>
      <div className="row between"><span>reps today <strong>{today?.reps ?? 0}</strong></span><span className="muted">streak {streak(rows)} day{streak(rows) === 1 ? '' : 's'}</span></div>
      <div className="two">
        <button className="good" onClick={() => mark(true)}>✓ good</button>
        <button className="again" onClick={() => mark(false)}>✗ again</button>
      </div>
      {/* the clicker owns the bottom half: it gets hit without looking */}
      <button className="clicker" onPointerDown={() => { unlockAudio(); click() }}>CLICK</button>
      <button className="row link" onClick={onTouchTarget}><span>Touch-target exercise</span><span>→</span></button>
    </div>
  )
}

/** Dog-facing: one giant pulsing target that clicks on contact. Teaches "nose the screen", the bridge to everything else. */
export function TouchTarget({ onExit }: { onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hits, setHits] = useState(0)
  const [flash, setFlash] = useState(false)
  useDogTouch(ref, () => { click(); setHits((h) => h + 1); setFlash(true); setTimeout(() => setFlash(false), 350) }, { ignore: inGateCorner, debounceMs: 600 })
  useEffect(() => () => {
    void exitKiosk()
    if (hits > 0) void put('training', { cue: 'Screen touch', day: dayKey(), reps: hits, misses: 0 })
  }, [hits > 0])
  return (
    <div ref={ref} className="dog-root touch-target">
      <div className={`big-target ${flash ? 'hit' : ''}`} />
      <div className="tt-count">{hits}</div>
      <OwnerGate onOpen={onExit} />
    </div>
  )
}
