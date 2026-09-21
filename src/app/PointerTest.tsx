import { useEffect, useRef, useState } from 'react'
import type { ClipRow } from '../recorder/clipStore'
import { recorder } from '../recorder/recorder'
import { shareSink } from '../recorder/share'
import { startCamera, stopCamera } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { AttentionMonitor } from './AttentionMonitor'

const TARGETS: [number, number][] = [[0.5, 0.5], [0.17, 0.25], [0.83, 0.25], [0.83, 0.75], [0.17, 0.75], [0.5, 0.25], [0.5, 0.75], [0.17, 0.5], [0.83, 0.5]]
const SETTLE_MS = 1500, MEASURE_MS = 3500
const DISTANCES = ['near (a hand’s length)', 'normal (a forearm)', 'far (arm’s length or more)']

interface Sample { ptr: { x: number; y: number } | null; raw: { x: number; y: number } | null; conf: number; yawUsed: boolean; ref: string | null }
export interface TargetResult { target: [number, number]; frames: number; found: number; errX: number; errY: number; jitterX: number; jitterY: number; rawJitterX: number; conf: number; yawUsedPct: number; earsPct: number }

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const std = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : 0 }

export function summarizeTarget(target: [number, number], samples: Sample[]): TargetResult {
  const hit = samples.filter((s) => s.ptr)
  const xs = hit.map((s) => s.ptr!.x), ys = hit.map((s) => s.ptr!.y), rx = samples.filter((s) => s.raw).map((s) => s.raw!.x)
  return {
    target, frames: samples.length, found: samples.length ? hit.length / samples.length : 0,
    errX: mean(xs) - target[0], errY: mean(ys) - target[1], jitterX: std(xs), jitterY: std(ys), rawJitterX: std(rx),
    conf: mean(samples.map((s) => s.conf)), yawUsedPct: mean(hit.map((s) => +s.yawUsed)), earsPct: mean(hit.map((s) => +(s.ref === 'ears'))),
  }
}

/**
 * Ground truth for the pointer: a target visits nine spots; the owner aims the dog (or a toy) at it. The clip and
 * its timeline (targets, raw and smoothed pointer, keypoints, confidences) are what get analysed on the Mac.
 */
export function PointerTest({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro')
  const [distance, setDistance] = useState(1)
  const [idx, setIdx] = useState(0)
  const [measuring, setMeasuring] = useState(false)
  const [sense, setSense] = useState<SenseState>(senses.state)
  const [results, setResults] = useState<TargetResult[]>([])
  const [clip, setClip] = useState<ClipRow | null>(null)
  const [note, setNote] = useState('')
  const samples = useRef<Sample[]>([])
  const collecting = useRef(false)

  useEffect(() => {
    let off = () => {}
    startCamera().then(() => { senses.start(); senses.setFps(10); off = senses.subscribe((st) => {
      setSense(st)
      if (collecting.current) samples.current.push({ ptr: st.nose, raw: st.rawNose, conf: st.noseConf, yawUsed: st.yawUsed, ref: st.ref })
    }) }).catch(() => setNote('Camera blocked.'))
    return () => { off(); senses.stop(); void recorder.stop().then(stopCamera) }
  }, [])

  useEffect(() => {
    if (phase !== 'run') return
    let cancelled = false
    const all: TargetResult[] = []
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      recorder.onSaved = (row) => setClip(row)
      await recorder.startManual('pointer-test')
      recorder.mark({ kind: 'pointer-test-start', distance: DISTANCES[distance], targets: TARGETS })
      for (let i = 0; i < TARGETS.length && !cancelled; i++) {
        setIdx(i); setMeasuring(false)
        recorder.mark({ kind: 'target', i, x: TARGETS[i][0], y: TARGETS[i][1], phase: 'settle' })
        await sleep(SETTLE_MS)
        samples.current = []; collecting.current = true; setMeasuring(true)
        recorder.mark({ kind: 'target', i, x: TARGETS[i][0], y: TARGETS[i][1], phase: 'measure' })
        await sleep(MEASURE_MS)
        collecting.current = false
        all.push(summarizeTarget(TARGETS[i], samples.current))
      }
      if (cancelled) return
      recorder.mark({ kind: 'pointer-test-summary', distance: DISTANCES[distance], results: all })
      await recorder.stop()
      setResults(all); setPhase('done')
    })()
    return () => { cancelled = true; collecting.current = false }
  }, [phase])

  if (phase === 'intro') return (
    <div className="ptest-intro">
      <h2>Pointer test</h2>
      <p>A yellow target visits nine spots, five seconds each. Hold the dog (or a toy) so its nose points at the target, as steadily as you can. About 45 seconds. The camera records the whole run so the tracking can be analysed afterwards.</p>
      <p className="muted">Run it once per distance. The numbers tell us where the pointer is off and where it shakes.</p>
      <div className="chips">{DISTANCES.map((d, i) => <button key={d} className={i === distance ? 'on' : ''} onClick={() => setDistance(i)}>{d}</button>)}</div>
      {note && <p className="note">{note}</p>}
      <p className="note">{sense.model === 'ready' ? (sense.hasDog ? `Dog found, nose confidence ${sense.noseConf.toFixed(2)}.` : 'Tracker ready. No dog in view yet.') : sense.model === 'loading' ? 'Loading the tracker…' : 'Tracking model not available.'}</p>
      <div className="two"><button onClick={onExit}>Back</button><button className="primary" disabled={sense.model !== 'ready'} onClick={() => setPhase('run')}>Start</button></div>
    </div>
  )

  if (phase === 'done') {
    const found = results.filter((r) => r.found > 0.2)
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`
    return (
      <div className="ptest-intro">
        <h2>Pointer test results</h2>
        <p className="muted">Units are percent of screen width / height. Error is where the pointer sat on average minus where the target was. Shake is how much it moved while you held still.</p>
        <div className="ptest-table">
          <table>
            <thead><tr><th>target</th><th>found</th><th>error x / y</th><th>shake x / y</th><th>raw shake x</th><th>nose conf</th></tr></thead>
            <tbody>{results.map((r, i) => (
              <tr key={i}><td>{Math.round(r.target[0] * 100)}, {Math.round(r.target[1] * 100)}</td><td>{Math.round(r.found * 100)}%</td>
                <td>{r.found ? `${pct(r.errX)} / ${pct(r.errY)}` : '—'}</td><td>{r.found ? `${(r.jitterX * 100).toFixed(1)} / ${(r.jitterY * 100).toFixed(1)}` : '—'}</td>
                <td>{(r.rawJitterX * 100).toFixed(1)}</td><td>{r.conf.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p>{found.length ? `Average: off by ${Math.round(mean(found.map((r) => Math.hypot(r.errX, r.errY))) * 100)}% of the screen, shaking ${(mean(found.map((r) => r.jitterX)) * 100).toFixed(1)}% side to side.` : 'The dog was not found at any target.'}</p>
        {note && <p className="note">{note}</p>}
        <div className="two">
          <button onClick={onExit}>Done</button>
          <button className="primary" disabled={!clip} onClick={async () => { if (clip) setNote((await shareSink.send([clip])) === 'cancelled' ? '' : 'Sent. Drop the zip in ml/inbox/ on the Mac.') }}>{clip ? 'Share this run' : 'Saving…'}</button>
        </div>
        <button className="ghost" onClick={() => { setResults([]); setClip(null); setPhase('intro') }}>Run again at another distance</button>
      </div>
    )
  }

  const [tx, ty] = TARGETS[idx]
  return (
    <div className="dog-root ptest">
      <div className={`ptest-target ${measuring ? 'measuring' : ''}`} style={{ left: `${tx * 100}%`, top: `${ty * 100}%` }} />
      <div className={`dog-cursor ${sense.nose ? '' : 'lost'}`} style={sense.nose ? { transform: `translate(${sense.nose.x * 100}vw, ${sense.nose.y * 100}vh)` } : undefined} />
      <div className="ptest-count">{idx + 1} / {TARGETS.length} · {measuring ? 'hold still' : 'aim'}</div>
      <AttentionMonitor s={sense} mode="test" />
    </div>
  )
}
