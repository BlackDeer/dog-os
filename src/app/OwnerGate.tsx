import { useEffect, useRef, useState } from 'react'

const HOLD_MS = 1500
const CORNER = 0.2   // top-left, as a fraction of the short edge: dog touches and game targets stay out of it
export const inGateCorner = (x: number, y: number, w: number, h: number) => { const g = Math.min(w, h) * CORNER; return x < g && y < g }

/**
 * The human's way out of dog mode: a visible button, top-left, that must be held for 1.5 s (a nose bump won't do it).
 * Esc works too on anything with a keyboard.
 */
export function OwnerGate({ onOpen }: { onOpen: () => void }) {
  const [progress, setProgress] = useState(0)
  const raf = useRef(0), t0 = useRef(0)
  const open = useRef(onOpen); open.current = onOpen

  const begin = () => {
    t0.current = performance.now()
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0.current) / HOLD_MS)
      setProgress(p)
      if (p >= 1) open.current(); else raf.current = requestAnimationFrame(tick)
    }
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick)
  }
  const cancel = () => { cancelAnimationFrame(raf.current); setProgress(0) }

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') open.current() }
    addEventListener('keydown', key)
    return () => { removeEventListener('keydown', key); cancelAnimationFrame(raf.current) }
  }, [])

  return (
    <button className="exit" aria-label="Hold to exit" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); begin() }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}>
      <svg viewBox="0 0 40 40" className="exit-ring"><circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${progress * 106.8} 106.8`} transform="rotate(-90 20 20)" /></svg>
      <span className="exit-x">✕</span>
      <span className="exit-label">{progress > 0 ? 'keep holding' : 'hold to exit'}</span>
    </button>
  )
}
