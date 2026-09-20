import { useEffect, useRef } from 'react'
import { TouchGate } from './hitTest'

export interface DogTouch { x: number; y: number; nx: number; ny: number; t: number }

/**
 * Paw/nose-friendly touch: any pointerdown counts, multi-touch collapses to the first contact,
 * 300 ms debounce, drags / long-presses / gestures are ignored. `ignore` lets the owner-gate corner opt out.
 */
export function useDogTouch(
  ref: React.RefObject<HTMLElement | null>,
  onTouch: (t: DogTouch) => void,
  opts: { debounceMs?: number; ignore?: (x: number, y: number, w: number, h: number) => boolean } = {},
) {
  const cb = useRef(onTouch); cb.current = onTouch
  const ig = useRef(opts.ignore); ig.current = opts.ignore
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const gate = new TouchGate(opts.debounceMs ?? 300)
    const down = (e: PointerEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      if (ig.current?.(x, y, r.width, r.height)) return
      if (gate.down(e.pointerId, e.timeStamp)) cb.current({ x, y, nx: x / r.width, ny: y / r.height, t: Date.now() })
    }
    const up = (e: PointerEvent) => gate.up(e.pointerId)
    const block = (e: Event) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    el.addEventListener('contextmenu', block)
    el.addEventListener('touchmove', block, { passive: false })
    el.addEventListener('gesturestart', block as EventListener)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', up)
      el.removeEventListener('contextmenu', block)
      el.removeEventListener('touchmove', block)
      el.removeEventListener('gesturestart', block as EventListener)
    }
  }, [ref, opts.debounceMs])
}
