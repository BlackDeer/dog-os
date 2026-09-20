import { useEffect, useMemo, useRef, useState } from 'react'

export const GATE_FRACTION = 0.16   // top-right corner, as a fraction of the short edge
export const inGateCorner = (x: number, y: number, w: number, h: number) => { const g = Math.min(w, h) * GATE_FRACTION; return x > w - g && y < g }

/** Hold the top-right corner (or the O key) for 3 s, then answer a sum. The only way out of dog mode. */
export function OwnerGate({ onOpen }: { onOpen: () => void }) {
  const [progress, setProgress] = useState(0)
  const [asking, setAsking] = useState(false)
  const raf = useRef(0), t0 = useRef(0), idle = useRef<number | null>(null)

  const begin = () => {
    if (asking) return
    t0.current = performance.now()
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0.current) / 3000)
      setProgress(p)
      if (p >= 1) { setProgress(0); setAsking(true) } else raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const cancel = () => { cancelAnimationFrame(raf.current); setProgress(0) }

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'o' && !e.repeat) begin() }
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'o') cancel() }
    addEventListener('keydown', down); addEventListener('keyup', up)
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); cancelAnimationFrame(raf.current) }
  }, [asking])

  useEffect(() => {
    if (!asking) return
    idle.current = window.setTimeout(() => setAsking(false), 10_000)   // silently back to dog mode
    return () => { if (idle.current) clearTimeout(idle.current) }
  }, [asking])

  const q = useMemo(() => {
    const a = 3 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 7), right = a + b
    const opts = new Set([right]); while (opts.size < 3) opts.add(right + Math.floor(Math.random() * 7) - 3 || right + 4)
    return { text: `${a} + ${b} = ?`, right, opts: [...opts].sort(() => Math.random() - 0.5) }
  }, [asking])

  return (
    <>
      <div className="gate-corner" onPointerDown={(e) => { e.stopPropagation(); begin() }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}>
        {progress > 0 && (
          <svg viewBox="0 0 40 40" className="gate-ring"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="3" strokeDasharray={`${progress * 100.5} 100.5`} transform="rotate(-90 20 20)" /></svg>
        )}
      </div>
      {asking && (
        <div className="gate-ask" onPointerDown={(e) => e.stopPropagation()}>
          <div className="gate-q">{q.text}</div>
          <div className="gate-opts">{q.opts.map((o) => <button key={o} onClick={() => { setAsking(false); if (o === q.right) onOpen() }}>{o}</button>)}</div>
        </div>
      )}
    </>
  )
}
