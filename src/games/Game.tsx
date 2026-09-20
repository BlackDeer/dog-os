import { useEffect, useRef, useState } from 'react'
import { boing, chime, squeak } from '../audio/sounds'
import { hitTest } from '../input/hitTest'
import { useDogTouch, type DogTouch } from '../input/useDogTouch'
import { sameZone, zoneOf, type Zone } from '../sensing/noseZones'

export type GameKind = 'bop' | 'chase'
interface Props { kind: GameKind; noseZone: Zone | null; noseDwellMs: number; onInteract: (t: DogTouch | null) => void; ignoreCorner: (x: number, y: number, w: number, h: number) => boolean }

const BLUE = '#3a86ff', YELLOW = '#ffd23f'
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string }

/** Bop: touch (or nose-dwell on) the drifting critter. Chase: a ball that flees contact. No fail states. */
export function Game({ kind, noseZone, noseDwellMs, onInteract, ignoreCorner }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [treat, setTreat] = useState(false)
  const sim = useRef({ x: 0, y: 0, vx: 0, vy: 0, r: 60, speed: 90, hits: 0, misses: 0, squash: 0, hue: 0, parts: [] as Particle[], lastNoseBop: 0, w: 0, h: 0 })
  const nose = useRef({ zone: noseZone, dwell: noseDwellMs }); nose.current = { zone: noseZone, dwell: noseDwellMs }

  const burst = (x: number, y: number, color: string) => {
    for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 260; sim.current.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color }) }
  }
  const respawn = () => {
    const s = sim.current, a = Math.random() * Math.PI * 2
    s.x = s.r + Math.random() * (s.w - 2 * s.r); s.y = s.r + Math.random() * (s.h - 2 * s.r)
    s.vx = Math.cos(a) * s.speed; s.vy = Math.sin(a) * s.speed; s.hue = (s.hue + 1) % 2
  }
  const bop = () => {
    const s = sim.current
    s.hits++; s.squash = 1
    burst(s.x, s.y, s.hue ? BLUE : YELLOW)
    if (kind === 'bop') {
      squeak(); respawn()
      // speed adapts to hit rate: easy when missing, livelier when hitting
      s.speed = Math.max(50, Math.min(260, s.speed * 1.08))
      if (s.hits % 5 === 0) { chime(); setTreat(true); setTimeout(() => setTreat(false), 2500) }
    }
  }

  useDogTouch(canvasRef, (t) => {
    const s = sim.current
    onInteract(t)
    if (kind === 'bop') {
      if (hitTest(t.x, t.y, [{ id: 'critter', x: s.x, y: s.y, r: s.r }], 1.6)) bop()
      else { s.misses++; s.speed = Math.max(50, s.speed * 0.93); burst(t.x, t.y, 'rgba(255,255,255,0.5)') }
    } else {
      // flee from the touch point
      const dx = s.x - t.x, dy = s.y - t.y, d = Math.hypot(dx, dy) || 1
      const kick = 520 * Math.max(0.35, 1 - d / Math.max(s.w, s.h))
      s.vx += (dx / d) * kick; s.vy += (dy / d) * kick
      boing(); bop()
    }
  }, { ignore: ignoreCorner })

  useEffect(() => {
    const canvas = canvasRef.current!, ctx = canvas.getContext('2d')!
    const s = sim.current
    let raf = 0, last = performance.now()
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      s.w = canvas.clientWidth; s.h = canvas.clientHeight
      canvas.width = s.w * dpr; canvas.height = s.h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      s.r = Math.min(s.w, s.h) * 0.175   // diameter = 35% of the short edge
      if (!s.x) respawn()
    }
    resize(); addEventListener('resize', resize)
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      // nose zones as a second input
      const n = nose.current
      if (n.zone && now - s.lastNoseBop > 1500) {
        const here = zoneOf(s.x / s.w, s.y / s.h)
        if (kind === 'bop' && sameZone(here, n.zone) && n.dwell >= 400) { s.lastNoseBop = now; onInteract(null); bop() }
        if (kind === 'chase' && sameZone(here, n.zone)) {
          s.lastNoseBop = now; onInteract(null)
          const cx = ((n.zone.col + 0.5) / 3) * s.w, cy = ((n.zone.row + 0.5) / 2) * s.h, dx = s.x - cx || 1, dy = s.y - cy || 1, d = Math.hypot(dx, dy)
          s.vx += (dx / d) * 380; s.vy += (dy / d) * 380; boing(); bop()
        }
      }
      if (kind === 'chase') { s.vx *= 1 - 0.9 * dt; s.vy *= 1 - 0.9 * dt; const v = Math.hypot(s.vx, s.vy); if (v < 40) { const a = Math.random() * 6.28; s.vx += Math.cos(a) * 30; s.vy += Math.sin(a) * 30 } }
      s.x += s.vx * dt; s.y += s.vy * dt
      if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx) } if (s.x > s.w - s.r) { s.x = s.w - s.r; s.vx = -Math.abs(s.vx) }
      if (s.y < s.r) { s.y = s.r; s.vy = Math.abs(s.vy) } if (s.y > s.h - s.r) { s.y = s.h - s.r; s.vy = -Math.abs(s.vy) }
      // keep the target out of the owner-gate corner
      if (s.x > s.w - s.r * 1.6 && s.y < s.r * 1.6) { s.vx = -Math.abs(s.vx) - 20; s.vy = Math.abs(s.vy) + 20 }
      s.squash = Math.max(0, s.squash - dt * 4)

      ctx.clearRect(0, 0, s.w, s.h)
      const wob = 1 + 0.06 * Math.sin(now / 180), sq = 1 - 0.25 * s.squash   // always moving a little: motion is what a dog's eye picks up
      const body = s.hue ? BLUE : YELLOW, accent = s.hue ? YELLOW : BLUE
      ctx.save(); ctx.translate(s.x, s.y); ctx.scale(wob / sq, wob * sq)
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.fill()
      if (kind === 'bop') {
        ctx.beginPath(); ctx.ellipse(-s.r * 0.62, -s.r * 0.82, s.r * 0.3, s.r * 0.42, -0.4, 0, Math.PI * 2); ctx.ellipse(s.r * 0.62, -s.r * 0.82, s.r * 0.3, s.r * 0.42, 0.4, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#05070d'; ctx.beginPath(); ctx.arc(-s.r * 0.33, -s.r * 0.15, s.r * 0.12, 0, 6.3); ctx.arc(s.r * 0.33, -s.r * 0.15, s.r * 0.12, 0, 6.3); ctx.fill()
        ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, s.r * 0.25, s.r * 0.16, 0, 6.3); ctx.fill()
      } else {
        ctx.strokeStyle = accent; ctx.lineWidth = s.r * 0.16; ctx.beginPath(); ctx.arc(0, 0, s.r * 0.62, now / 300, now / 300 + Math.PI * 1.2); ctx.stroke()
      }
      ctx.restore()
      s.parts = s.parts.filter((p) => (p.life -= dt * 1.6) > 0)
      for (const p of s.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 9 * p.life + 3, 0, 6.3); ctx.fill() }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize) }
  }, [kind])

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game-canvas" />
      {treat && <div className="treat-cue">TREAT</div>}
    </div>
  )
}
