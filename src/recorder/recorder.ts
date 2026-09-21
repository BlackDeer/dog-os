// Records the same camera stream the pose engine reads, with a sidecar timeline of what the app knew.
import { cameraStream } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { KEYPOINTS } from '../sensing/types'
import { getSettings } from '../store/settings'
import { enforceCap, saveClip, type ClipRow } from './clipStore'

export const APP_VERSION = '0.1.0'
const CHUNK_SEC = 120, SNIPPET_SEC = 10, SNIPPET_MAX_SEC = 30, SNIPPET_GAP_SEC = 45

export interface Context { mode: string; videoId: string | null; tag: string | null }
type TimelineEntry =
  | { t: number; type: 'pose'; mode: string; videoId: string | null; att: number; arousal: string; score: number; ptr?: number[]; raw?: number[]; yaw?: number; neutral?: number; yawUsed?: boolean; ref?: string | null; prox?: number; inferMs?: number; box?: number[]; kpts?: number[][] }
  | { t: number; type: 'mark'; [k: string]: unknown }
  | { t: number; type: 'touch'; x: number; y: number; mode: string }
  | { t: number; type: 'context'; mode: string; videoId: string | null; tag: string | null }

export function pickMime(): string {
  const prefs = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  return prefs.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
}

class ClipRecorder {
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private timeline: TimelineEntry[] = []
  private clipStart = 0
  private trigger = ''
  private stopTimer: number | null = null
  private hardStopAt = 0
  private lastSnippetEnd = -Infinity
  private running = false
  private mode: 'full' | 'snippets' = 'full'
  private ctx: Context = { mode: 'rest', videoId: null, tag: null }
  private unsub: (() => void) | null = null
  private prevAttending = false
  private audioTrack: MediaStreamTrack | null = null
  onSaved: ((row: ClipRow) => void) | null = null
  get active() { return this.running }
  get capturing() { return !!this.rec }

  async start() {
    if (this.running) return
    const s = getSettings()
    // auto = whole session until a pose model exists, smart snippets after
    this.mode = s.recordMode === 'auto' ? (senses.state.model === 'ready' ? 'snippets' : 'full') : s.recordMode
    if (s.recordAudio) { try { this.audioTrack = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0] } catch { this.audioTrack = null } }
    this.running = true
    this.unsub = senses.subscribe((st) => this.onSense(st))
    if (this.mode === 'full') this.begin('session', CHUNK_SEC)
  }

  async stop() {
    this.running = false
    this.unsub?.(); this.unsub = null
    await this.end()
    this.audioTrack?.stop(); this.audioTrack = null
  }

  /** One continuous clip outside a dog session (used by the pointer test). Stop it with `stop()`. */
  async startManual(trigger: string, maxSec = 300) {
    if (this.running) await this.stop()
    this.running = true; this.mode = 'full'
    this.unsub = senses.subscribe((st) => this.onSense(st))
    this.begin(trigger, maxSec)
  }

  /** Adds a custom entry to the running clip's timeline. */
  mark(entry: Record<string, unknown>) { if (this.rec) this.timeline.push({ t: this.now(), type: 'mark', ...entry }) }

  setContext(c: Context) {
    this.ctx = c
    if (this.rec) this.timeline.push({ t: this.now(), type: 'context', ...c })
  }

  noteTouch(nx: number, ny: number) {
    if (!this.running) return
    if (this.mode === 'snippets') this.triggerSnippet('touch')
    if (this.rec) this.timeline.push({ t: this.now(), type: 'touch', x: +nx.toFixed(3), y: +ny.toFixed(3), mode: this.ctx.mode })
  }

  private now() { return Math.round(performance.now() - this.clipStart) }

  private onSense(st: SenseState) {
    if (this.mode === 'snippets' && st.hasDog) {
      const attending = st.presence === 'attending'
      if (attending !== this.prevAttending) this.triggerSnippet(attending ? 'attention-up' : 'attention-down')
      this.prevAttending = attending
      // the frames worth labeling: a dog is there but the model isn't sure where its face is
      if (st.pose && st.pose.score > 0.5 && st.noseConf < 0.5) this.triggerSnippet('low-confidence')
    }
    if (!this.rec) return
    const r = (v: number) => +v.toFixed(4)
    this.timeline.push({
      t: this.now(), type: 'pose', mode: this.ctx.mode, videoId: this.ctx.videoId, att: r(st.attention), arousal: st.arousal, score: r(st.pose?.score ?? 0),
      ptr: st.nose ? [r(st.nose.x), r(st.nose.y)] : undefined, raw: st.rawNose ? [r(st.rawNose.x), r(st.rawNose.y)] : undefined,
      yaw: r(st.yaw), neutral: r(st.neutralYaw), yawUsed: st.yawUsed, ref: st.ref, prox: r(st.proximity), inferMs: Math.round(st.inferMs),
      box: st.pose ? [r(st.pose.box.x), r(st.pose.box.y), r(st.pose.box.w), r(st.pose.box.h)] : undefined,
      kpts: st.pose?.kpts.map((k) => [r(k.x), r(k.y), +k.c.toFixed(2)]),
    })
  }

  private triggerSnippet(why: string) {
    const t = performance.now()
    if (this.rec) {   // extend the running snippet, up to a ceiling
      if (this.stopTimer) clearTimeout(this.stopTimer)
      const until = Math.min(this.hardStopAt, t + SNIPPET_SEC * 1000)
      this.stopTimer = window.setTimeout(() => void this.end(), Math.max(500, until - t))
      return
    }
    if ((t - this.lastSnippetEnd) / 1000 < SNIPPET_GAP_SEC) return
    this.begin(why, SNIPPET_SEC)
  }

  private begin(trigger: string, seconds: number) {
    const stream = cameraStream()
    if (!stream || this.rec) return
    const mime = pickMime()
    const tracks = [...stream.getVideoTracks(), ...(this.audioTrack ? [this.audioTrack] : [])]
    try {
      this.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: 800_000, audioBitsPerSecond: 48_000 })
    } catch { this.rec = null; return }
    this.chunks = []; this.timeline = []; this.trigger = trigger
    this.clipStart = performance.now()
    this.hardStopAt = this.clipStart + (this.mode === 'snippets' ? SNIPPET_MAX_SEC : seconds) * 1000
    this.timeline.push({ t: 0, type: 'context', ...this.ctx })
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) }
    this.rec.start(1000)
    this.stopTimer = window.setTimeout(() => void this.end(true), seconds * 1000)
  }

  /** Stops the current clip and saves it. In full-session mode, `rollover` starts the next chunk straight away. */
  private end(rollover = false): Promise<void> {
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = null }
    const rec = this.rec
    if (!rec) return Promise.resolve()
    this.rec = null
    return new Promise((resolve) => {
      rec.onstop = async () => {
        const durSec = (performance.now() - this.clipStart) / 1000
        const startWall = Date.now() - durSec * 1000
        const video = new Blob(this.chunks, { type: rec.mimeType || 'video/webm' })
        const id = `${getSettings().dogName.toLowerCase().replace(/\W+/g, '-') || 'dog'}-${new Date(startWall).toISOString().replace(/[:.]/g, '-')}`
        const row: ClipRow = { id, start: startWall, durSec, bytes: video.size, shared: false, trigger: this.trigger, mime: rec.mimeType || 'video/webm', hasAudio: !!this.audioTrack }
        this.lastSnippetEnd = performance.now()
        if (video.size > 0 && durSec > 1) {
          try { await saveClip(row, video, this.meta(row)); await enforceCap(getSettings().storageCapMB); this.onSaved?.(row) } catch (e) { console.warn('clip save failed', e) }
        }
        if (rollover && this.running && this.mode === 'full') this.begin('session', CHUNK_SEC)
        resolve()
      }
      try { rec.stop() } catch { resolve() }
    })
  }

  private meta(row: ClipRow) {
    const s = getSettings(), vs = cameraStream()?.getVideoTracks()[0]?.getSettings()
    return {
      format: 'dogos-clip/1', appVersion: APP_VERSION, clipId: row.id, dogName: s.dogName, startedAt: new Date(row.start).toISOString(),
      durationSec: +row.durSec.toFixed(2), trigger: row.trigger, mime: row.mime, hasAudio: row.hasAudio,
      device: { userAgent: navigator.userAgent, screen: [screen.width, screen.height], dpr: devicePixelRatio, orientation: screen.orientation?.type ?? '' },
      camera: { width: vs?.width, height: vs?.height, frameRate: vs?.frameRate, facingMode: vs?.facingMode, mirrored: false },
      model: { state: senses.state.model, keypoints: KEYPOINTS, coords: 'normalized 0..1 in the un-mirrored camera frame; touches are normalized screen coords' },
      timeline: this.timeline,
    }
  }
}

export const recorder = new ClipRecorder()
