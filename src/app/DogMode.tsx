import { useEffect, useRef, useState } from 'react'
import { ambient, ripple as rippleSound, setVolumeCap, unlockAudio } from '../audio/sounds'
import { PRESET_WEIGHTS, emptyBandit, pick, update, type Arm, type BanditState } from '../brain/bandit'
import { DEFAULT_CONFIG, Scheduler, type Action, type Mode } from '../brain/scheduler'
import { centroid, cosine } from '../brain/similarity'
import { Player, type PlayerHandle } from '../content/Player'
import { getFlags, isCalm, loadCatalog, setFlags, thumb, type Flags, type Video } from '../content/catalog'
import { Game, type GameKind } from '../games/Game'
import { useDogTouch } from '../input/useDogTouch'
import { recorder } from '../recorder/recorder'
import { startCamera } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { kvGet, kvSet, put, type PlayRecord } from '../store/db'
import { getSettings, inQuietHours, useSettings } from '../store/settings'
import { AttentionMonitor } from './AttentionMonitor'
import { OwnerGate, inGateCorner } from './OwnerGate'
import { enterKiosk, exitKiosk } from './kiosk'

interface NowPlaying { arm: Arm; kind: 'video' | 'game'; start: number; attSum: number; rewSum: number; n: number; touches: number; workedUpSec: number }
interface Ripple { id: number; x: number; y: number }
const GAME_ARMS: Arm[] = [{ id: 'game-bop', tags: ['game'] }, { id: 'game-chase', tags: ['game'] }]

export function DogMode({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const root = useRef<HTMLDivElement>(null)
  const player = useRef<PlayerHandle>(null)
  const sched = useRef(new Scheduler())
  const bandit = useRef<BanditState>(emptyBandit())
  const catalog = useRef<Video[]>([])
  const flags = useRef<Flags>({ pinned: [], blocked: [], failed: {} })
  const playing = useRef<NowPlaying | null>(null)
  const recent = useRef<string[]>([])
  const lastInteraction = useRef(0)
  const failsInRow = useRef(0)
  const sessionId = useRef(`s-${Date.now()}`)
  const sessionStart = useRef(Date.now())
  const [mode, setMode] = useState<Mode>('rest')
  const [game, setGame] = useState<GameKind>('bop')
  const [picks, setPicks] = useState<Video[]>([])
  const [ripples, setRipples] = useState<Ripple[]>([])
  const [sense, setSense] = useState<SenseState>(senses.state)
  const [recording, setRecording] = useState(false)

  // ---- choosing ----------------------------------------------------------------------------------
  const arms = (calmOnly = false): (Arm & { video: Video })[] => {
    const s = getSettings()
    return catalog.current
      .filter((v) => !flags.current.blocked.includes(v.id) && (flags.current.failed[v.id] ?? 0) < 3)
      .filter((v) => (!s.fileOnly || v.source === 'file') && (navigator.onLine || v.source === 'file'))
      .filter((v) => !calmOnly || isCalm(v))
      .map((v) => ({ id: v.id, tags: v.tags, pinned: flags.current.pinned.includes(v.id), video: v }))
  }
  /** Exploration isn't random when we have embeddings: prefer unplayed videos that look like what held attention. */
  const exploreRank = (pool: Arm[]) => {
    const byId = new Map(catalog.current.map((v) => [v.id, v]))
    const liked = Object.entries(bandit.current.items).filter(([, b]) => b.a + b.b > 2.5 && b.a / (b.a + b.b) > 0.55).map(([id]) => byId.get(id)?.embedding).filter(Boolean) as Float32Array[]
    const c = centroid(liked)
    const fresh = pool.filter((a) => !bandit.current.items[a.id])
    const cand = fresh.length ? fresh : pool
    if (!c) return [cand[Math.floor(Math.random() * cand.length)]]
    return [...cand].sort((a, b) => cosine(c, byId.get(b.id)?.embedding ?? c) - cosine(c, byId.get(a.id)?.embedding ?? c))
  }
  const choose = (calmOnly = false) => pick(bandit.current, arms(calmOnly), {
    exclude: recent.current, tagWeights: PRESET_WEIGHTS[getSettings().preset], exploreRank,
  }) as (Arm & { video: Video }) | null

  // ---- bookkeeping -------------------------------------------------------------------------------
  const finishPlay = async () => {
    const p = playing.current
    playing.current = null
    if (!p || !p.n) return
    const durSec = (Date.now() - p.start) / 1000
    const meanReward = p.rewSum / p.n, meanAttention = p.attSum / p.n
    // games are rewarded by touches per minute; videos by attention × calm
    const r = p.kind === 'game' ? Math.min(1, p.touches / Math.max(0.5, durSec / 60) / 12) : meanReward
    if (senses.state.model === 'ready' || p.kind === 'game') bandit.current = update(bandit.current, p.arm, r, Math.min(1, durSec / 90))
    void kvSet('bandit', bandit.current)
    const rec: PlayRecord = { sessionId: sessionId.current, kind: p.kind, itemId: p.arm.id, tag: p.arm.tags[0] ?? '', start: p.start, durSec, meanAttention, meanReward: r, touches: p.touches, workedUpSec: p.workedUpSec }
    await put('plays', rec)
  }
  const begin = (arm: Arm, kind: 'video' | 'game') => { playing.current = { arm, kind, start: Date.now(), attSum: 0, rewSum: 0, n: 0, touches: 0, workedUpSec: 0 } }

  const playVideo = async (chosen: (Arm & { video: Video }) | null) => {
    await finishPlay()
    if (!chosen) { offlineFallback(); return }
    recent.current = [chosen.id, ...recent.current].slice(0, Math.min(6, Math.max(1, arms().length - 1)))
    begin(chosen, 'video')
    recorder.setContext({ mode: 'watch', videoId: chosen.id, tag: chosen.tags[0] ?? null })
    void player.current?.play(chosen.video)
  }
  const offlineFallback = () => { apply(sched.current.forceMode('play', performance.now())) }

  // ---- scheduler actions -------------------------------------------------------------------------
  function apply(actions: Action[]) {
    for (const a of actions) {
      if (getSettings().devMode) console.debug('[dogos]', JSON.stringify(a))
      if (a.type === 'enter') {
        setMode(a.mode)
        recorder.setContext({ mode: a.mode, videoId: null, tag: null })
        const nose = getSettings().noseCursor
        senses.setFps(a.mode === 'rest' ? 1 : nose ? (a.mode === 'watch' ? 8 : 10) : 2)
        if (a.mode === 'rest') { void finishPlay(); player.current?.stop(); ambient(true) } else ambient(a.mode === 'play' && !navigator.onLine)
        if (a.mode === 'play') {
          void finishPlay().then(() => {
            player.current?.stop()
            const g = pick(bandit.current, GAME_ARMS, { explore: 0.3 }) ?? GAME_ARMS[0]
            setGame(g.id === 'game-chase' ? 'chase' : 'bop'); begin(g, 'game'); lastInteraction.current = performance.now()
          })
        }
        if (a.mode === 'pick') {
          const first = choose(), second = first ? (pick(bandit.current, arms().filter((x) => x.id !== first.id), { exclude: recent.current }) as (Arm & { video: Video }) | null) : null
          if (first && second) setPicks([first.video, second.video])
          else apply([...sched.current.picked(performance.now()), { type: 'next-video', reason: 'timer' }])
        }
      }
      if (a.type === 'next-video') void playVideo(choose(a.calmOnly))
    }
  }

  const choosePick = (v: Video) => {
    setPicks([])
    apply(sched.current.picked(performance.now()))
    void playVideo({ id: v.id, tags: v.tags, video: v })
  }

  // ---- lifecycle ---------------------------------------------------------------------------------
  useEffect(() => {
    let alive = true
    const s = getSettings()
    unlockAudio(); setVolumeCap(s.volumeCap)
    void enterKiosk()
    void player.current?.prime()
    ;(async () => {
      catalog.current = await loadCatalog()
      flags.current = await getFlags()
      bandit.current = await kvGet('bandit', emptyBandit())
      try {
        await startCamera(); senses.start()
        if (s.record) { await recorder.start(); if (alive) setRecording(true) }
      } catch { /* no camera: the app still plays, it just can't see */ }
    })()
    const unsub = senses.subscribe((st) => {
      setSense(st)
      const p = playing.current
      if (p && st.model === 'ready') { p.attSum += st.attention; p.rewSum += st.reward; p.n++; if (st.arousal === 'worked-up') p.workedUpSec += 0.5 }
      // nose zones choose on the PICK screen
      if (getSettings().noseCursor && sched.current.mode === 'pick' && st.zone && st.zoneDwellMs > 1500 && st.zone.col !== 1) {
        setPicks((cur) => { if (cur.length === 2) setTimeout(() => choosePick(cur[st.zone!.col === 0 ? 0 : 1]), 0); return cur })
      }
    })
    const loop = window.setInterval(() => {
      const cur = getSettings(), st = senses.state
      sched.current.cfg = { ...DEFAULT_CONFIG, rotateAfterSec: cur.rotateAfterSec, sessionSec: cur.sessionMin * 60, cooldownSec: cur.restMin * 60, pickEnabled: cur.pickScreen, gamesEnabled: cur.preset !== 'calm' || true }
      const p = playing.current
      if (p && st.model !== 'ready') p.n++   // keep duration bookkeeping alive without sensing
      apply(sched.current.step({
        now: performance.now(), presence: st.presence, attention: st.attention, reward: st.reward, arousal: st.arousal,
        sensing: st.model === 'ready', quiet: inQuietHours(cur), lastInteraction: lastInteraction.current,
      }))
    }, 500)
    return () => {
      alive = false
      clearInterval(loop); unsub()
      void finishPlay()
      void put('sessions', { id: sessionId.current, start: sessionStart.current, end: Date.now(), activeSec: sched.current.activeSeconds, preset: getSettings().preset })
      void recorder.stop()
      senses.stop(); ambient(false)
      void exitKiosk()
    }
  }, [])

  useEffect(() => { player.current?.setVolume(settings.volumeCap); setVolumeCap(settings.volumeCap) }, [settings.volumeCap])

  // ---- touch in WATCH / REST / PICK: feedback only, never navigation ------------------------------
  useDogTouch(root, (t) => {
    if (sched.current.mode === 'play') return   // the game canvas handles its own touches
    lastInteraction.current = performance.now()
    senses.noteTouch(); recorder.noteTouch(t.nx, t.ny)
    if (playing.current) playing.current.touches++
    if (sched.current.mode === 'pick' && picks.length === 2) return choosePick(picks[t.nx < 0.5 ? 0 : 1])
    rippleSound()
    const id = Date.now() + Math.random()
    setRipples((r) => [...r.slice(-4), { id, x: t.x, y: t.y }])
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 1200)
  }, { ignore: inGateCorner })

  const onVideoFail = (v: Video, why: string) => {
    console.warn('skipping', v.id, why)
    flags.current = { ...flags.current, failed: { ...flags.current.failed, [v.id]: (flags.current.failed[v.id] ?? 0) + 1 } }
    void setFlags(flags.current)
    playing.current = null
    if (++failsInRow.current >= 3) { failsInRow.current = 0; return offlineFallback() }   // no error UI: fall back to games
    void playVideo(choose())
  }

  const pip = recording && recorder.capturing ? 'rec' : sense.hasDog ? 'dog' : 'none'
  return (
    <div ref={root} className={`dog-root mode-${mode}`}>
      <Player ref={player} volume={settings.volumeCap} dimmed={mode === 'rest'} onFail={onVideoFail} onPlaying={() => { failsInRow.current = 0 }} />
      {mode === 'rest' && <RestScene />}
      {mode === 'play' && (
        <Game kind={game} pointer={settings.noseCursor ? sense.nose : null} ignoreCorner={inGateCorner}
          onInteract={(t) => { lastInteraction.current = performance.now(); senses.noteTouch(); if (t) recorder.noteTouch(t.nx, t.ny); if (playing.current) playing.current.touches++ }} />
      )}
      {mode === 'pick' && picks.length === 2 && (
        <div className="pick">{picks.map((v, i) => <div key={v.id} className={`pick-half pick-${i}`} style={thumb(v) ? { backgroundImage: `url(${thumb(v)!.replace('mqdefault', 'hqdefault')})` } : undefined} />)}</div>
      )}
      {ripples.map((r) => <div key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />)}
      {settings.devMode && settings.showHud && <Hud s={sense} mode={mode} />}
      {settings.noseCursor && settings.showCursor && mode !== 'rest' && (
        <div className={`dog-cursor ${sense.nose ? '' : 'lost'}`} style={sense.nose ? { transform: `translate(${sense.nose.x * 100}vw, ${sense.nose.y * 100}vh)` } : undefined} />
      )}
      {settings.showMonitor && <AttentionMonitor s={sense} mode={mode} />}
      <div className={`pip pip-${pip}`} />
      <OwnerGate onOpen={onExit} />
    </div>
  )
}

function RestScene() {
  return <div className="rest">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={`blob blob-${i}`} />)}</div>
}

function Hud({ s, mode }: { s: SenseState; mode: Mode }) {
  return (
    <pre className="hud">{[
      `mode ${mode}   model ${s.model}${s.modelNote ? ' (' + s.modelNote + ')' : ''}`,
      `dog ${s.hasDog ? 'yes' : 'no '}  presence ${s.presence}  arousal ${s.arousal}`,
      `attention ${s.attention.toFixed(2)}  reward ${s.reward.toFixed(2)}  yaw ${s.yaw.toFixed(2)}`,
      `nose ${s.nose ? s.nose.x.toFixed(2) + ',' + s.nose.y.toFixed(2) : '—'}  conf ${s.noseConf.toFixed(2)}  zone ${s.zone ? s.zone.col + ',' + s.zone.row : '—'}`,
      `${s.fps.toFixed(1)} fps  ${s.inferMs.toFixed(0)} ms`,
    ].join('\n')}</pre>
  )
}
