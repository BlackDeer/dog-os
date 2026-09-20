// Forgiving hit-testing for noses and paws: the nearest target within a generous radius wins.
export interface Target { id: string; x: number; y: number; r: number }

export function hitTest(x: number, y: number, targets: Target[], slop = 1.6): Target | null {
  let best: Target | null = null
  let bestD = Infinity
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y)
    if (d <= t.r * slop && d < bestD) { best = t; bestD = d }
  }
  return best
}

/** Collapses a stream of pointer contacts into "dog touches": first contact only, debounced. */
export class TouchGate {
  private last = -Infinity
  private active = new Set<number>()
  constructor(private debounceMs = 300) {}
  down(pointerId: number, now: number): boolean {
    const first = this.active.size === 0
    this.active.add(pointerId)
    if (!first) return false
    if (now - this.last < this.debounceMs) return false
    this.last = now
    return true
  }
  up(pointerId: number) { this.active.delete(pointerId) }
  reset() { this.active.clear() }
}
