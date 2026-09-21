import { useEffect, useRef } from 'react'
import { cameraVideo } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { KP } from '../sensing/types'

const LIVE = [KP.nose, KP.left_eye, KP.right_eye, KP.left_ear_base, KP.right_ear_base, KP.left_ear_tip, KP.right_ear_tip, KP.chin]
const HISTORY_SEC = 45

/**
 * Temporary pre-screening readout, top-right of dog mode: what the camera sees, what the model found, and the
 * attention score over the last 45 s. pointer-events: none, so the owner gate underneath still works.
 */
export function AttentionMonitor({ s, mode }: { s: SenseState; mode: string }) {
  const view = useRef<HTMLCanvasElement>(null)
  const chart = useRef<HTMLCanvasElement>(null)
  const hist = useRef<{ t: number; a: number; dog: boolean }[]>([])

  useEffect(() => {
    const id = window.setInterval(() => {
      const st = senses.state, now = performance.now()
      hist.current.push({ t: now, a: st.attention, dog: st.hasDog })
      while (hist.current.length && now - hist.current[0].t > HISTORY_SEC * 1000) hist.current.shift()

      const c = view.current, v = cameraVideo()
      if (c && v && v.videoWidth) {
        const g = c.getContext('2d')!, W = c.width, H = c.height
        g.save(); g.scale(-1, 1); g.drawImage(v, -W, 0, W, H); g.restore()   // mirrored, like a selfie preview
        const p = st.pose
        if (p) {
          g.strokeStyle = '#3a86ff'; g.lineWidth = 2
          g.strokeRect((1 - p.box.x - p.box.w) * W, p.box.y * H, p.box.w * W, p.box.h * H)
          for (const i of LIVE) {
            const k = p.kpts[i]
            if (k.c < 0.35) continue
            g.fillStyle = i === KP.nose ? '#ffd23f' : i === KP.left_eye || i === KP.right_eye ? '#fff' : '#3a86ff'
            g.beginPath(); g.arc((1 - k.x) * W, k.y * H, i === KP.nose ? 5 : 3, 0, 6.3); g.fill()
          }
        }
      }
      const ch = chart.current
      if (ch) {
        const g = ch.getContext('2d')!, W = ch.width, H = ch.height
        g.clearRect(0, 0, W, H)
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, H * (1 - 0.45), W, 1)   // the "attending" threshold
        g.beginPath()
        hist.current.forEach((h, i) => { const x = W - ((now - h.t) / (HISTORY_SEC * 1000)) * W, y = H - 2 - h.a * (H - 4); if (i) g.lineTo(x, y); else g.moveTo(x, y) })
        g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.stroke()
      }
    }, 200)
    return () => clearInterval(id)
  }, [])

  const pct = Math.round(s.attention * 100)
  const label = s.model === 'loading' ? 'loading model…' : s.model === 'unavailable' ? 'no model' : s.presence
  return (
    <div className="monitor">
      <canvas ref={view} width={192} height={144} className="monitor-view" />
      <div className={`monitor-state st-${s.model === 'ready' ? s.presence : 'off'}`}>{label}</div>
      <div className="monitor-bar"><i style={{ width: `${pct}%` }} /><em>attention {pct}%</em></div>
      <canvas ref={chart} width={192} height={44} className="monitor-chart" />
      <div className="monitor-meta">{s.arousal} · {mode} · {s.fps.toFixed(1)} fps · {s.inferMs.toFixed(0)} ms</div>
      <div className="monitor-meta">nose {s.noseConf.toFixed(2)} · yaw {s.yaw.toFixed(2)} · zone {s.zone ? `${s.zone.col},${s.zone.row}` : '—'}</div>
    </div>
  )
}
