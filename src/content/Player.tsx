import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Video } from './catalog'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }

let apiPromise: Promise<any> | null = null
function loadYouTubeApi(): Promise<any> {
  return (apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { apiPromise = null; reject(new Error('youtube api blocked or offline')) }
    document.head.appendChild(s)
  }))
}

export interface PlayerHandle {
  /** Must first be called from inside a user gesture (the owner's Start tap) so unmuted autoplay is allowed. */
  prime(): Promise<void>
  play(v: Video): Promise<void>
  stop(): void
  setVolume(v: number): void
  /** Where playback is right now; logged with every camera frame so the screen can be rebuilt later. */
  probe(): { t: number | null; dur: number | null; state: string }
}
interface Props { volume: number; dimmed?: boolean; onFail: (v: Video, why: string) => void; onPlaying?: (v: Video) => void }

const FADE_MS = 750
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const Player = forwardRef<PlayerHandle, Props>(function Player({ volume, dimmed, onFail, onPlaying }, ref) {
  const ytHost = useRef<HTMLDivElement>(null)
  const fileEl = useRef<HTMLVideoElement>(null)
  const curtain = useRef<HTMLDivElement>(null)
  const yt = useRef<any>(null)
  const current = useRef<Video | null>(null)
  const vol = useRef(volume); vol.current = volume
  const watchdog = useRef<number | null>(null)
  const ramp = useRef<number | null>(null)
  const cb = useRef({ onFail, onPlaying }); cb.current = { onFail, onPlaying }

  const applyVolume = (f: number) => {
    const v = Math.max(0, Math.min(1, vol.current * f))
    try { yt.current?.setVolume?.(Math.round(v * 100)) } catch { /* not ready */ }
    if (fileEl.current) fileEl.current.volume = v
  }
  const rampUp = () => {   // audio comes in over 2 s so nothing is sudden
    if (ramp.current) clearInterval(ramp.current)
    let f = 0; applyVolume(0)
    ramp.current = window.setInterval(() => { f = Math.min(1, f + 0.05); applyVolume(f); if (f >= 1 && ramp.current) { clearInterval(ramp.current); ramp.current = null } }, 100)
  }
  const fade = async (to: number) => { if (curtain.current) curtain.current.style.opacity = String(to); await sleep(FADE_MS) }
  const clearWatchdog = () => { if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null } }
  const fail = (v: Video, why: string) => { clearWatchdog(); if (current.current?.id === v.id) cb.current.onFail(v, why) }
  const started = (v: Video) => { clearWatchdog(); if (current.current?.id !== v.id) return; rampUp(); void fade(0); cb.current.onPlaying?.(v) }

  async function ensureYT() {
    if (yt.current) return
    const YT = await loadYouTubeApi()
    await new Promise<void>((resolve) => {
      const p = new YT.Player(ytHost.current!.firstElementChild, {
        width: '100%', height: '100%', host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => { yt.current = p; p.getIframe().setAttribute('allow', 'autoplay; encrypted-media'); resolve() },
          onError: (e: any) => { const v = current.current; if (v?.source === 'youtube') fail(v, 'youtube error ' + e.data) },
          onStateChange: (e: any) => {
            const v = current.current
            if (!v || v.source !== 'youtube') return
            if (e.data === YT.PlayerState.PLAYING) {
              const d = p.getDuration?.() ?? 0
              if (!(p as any).__seeked) {
                (p as any).__seeked = true
                if (v.startAt != null) { if (v.startAt > 0) p.seekTo(v.startAt, true) }                                          // openers start where the action is
                else if (d > 900) p.seekTo(Math.floor(Math.random() * d * 0.7), true)           // vary long ambient videos
              }
              started(v)
            }
            if (e.data === YT.PlayerState.ENDED) { p.seekTo(0, true); p.playVideo() }
          },
        },
      })
    })
  }

  useImperativeHandle(ref, () => ({
    async prime() { try { await ensureYT() } catch { /* offline: file sources still work */ } },
    async play(v) {
      current.current = v
      clearWatchdog()
      await fade(1)
      applyVolume(0)
      const showYT = v.source === 'youtube'
      if (ytHost.current) ytHost.current.style.visibility = showYT ? 'visible' : 'hidden'
      if (fileEl.current) fileEl.current.style.visibility = showYT ? 'hidden' : 'visible'
      if (showYT) {
        fileEl.current?.pause()
        try { await ensureYT() } catch { return fail(v, 'youtube unavailable') }
        yt.current.__seeked = false
        yt.current.unMute(); yt.current.loadVideoById(v.ref)
        // still not playing after 8 s → autoplay was probably blocked: retry muted, then give up
        watchdog.current = window.setTimeout(() => {
          try { yt.current.mute(); yt.current.playVideo() } catch { /* ignore */ }
          watchdog.current = window.setTimeout(() => fail(v, 'did not start'), 8000)
        }, 8000)
      } else {
        try { yt.current?.pauseVideo?.() } catch { /* ignore */ }
        const el = fileEl.current!
        el.src = v.ref; el.loop = true; el.muted = false
        if (v.startAt) el.addEventListener('loadedmetadata', () => { el.currentTime = v.startAt! }, { once: true })
        el.onplaying = () => started(v)
        el.onerror = () => fail(v, 'file error')
        el.play().catch(() => { el.muted = true; el.play().catch(() => fail(v, 'did not start')) })
        watchdog.current = window.setTimeout(() => fail(v, 'did not start'), 15000)
      }
    },
    stop() {
      clearWatchdog(); current.current = null
      void fade(1)
      try { yt.current?.pauseVideo?.() } catch { /* ignore */ }
      fileEl.current?.pause()
    },
    setVolume(v) { vol.current = v; applyVolume(1) },
    probe() {
      const v = current.current
      try {
        if (v?.source === 'youtube' && yt.current?.getCurrentTime) {
          const st = yt.current.getPlayerState?.()
          const name = ({ [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' } as Record<number, string>)[st] ?? 'unknown'
          return { t: +yt.current.getCurrentTime().toFixed(2), dur: yt.current.getDuration?.() || null, state: name }
        }
        if (v?.source === 'file' && fileEl.current) { const el = fileEl.current; return { t: +el.currentTime.toFixed(2), dur: isFinite(el.duration) ? el.duration : null, state: el.paused ? 'paused' : el.readyState < 3 ? 'buffering' : 'playing' } }
      } catch { /* player not ready */ }
      return { t: null, dur: null, state: 'none' }
    },
  }))

  useEffect(() => () => { clearWatchdog(); if (ramp.current) clearInterval(ramp.current); try { yt.current?.destroy?.() } catch { /* ignore */ } }, [])

  return (
    <div className="player" style={{ opacity: dimmed ? 0.15 : 1 }}>
      <div ref={ytHost} className="player-layer"><div /></div>
      <video ref={fileEl} className="player-layer" playsInline style={{ visibility: 'hidden', objectFit: 'cover' }} />
      <div ref={curtain} className="player-curtain" style={{ opacity: 1 }} />
      {/* the shield: touches never reach the iframe, so a nose can't open YouTube */}
      <div className="player-shield" />
    </div>
  )
})
