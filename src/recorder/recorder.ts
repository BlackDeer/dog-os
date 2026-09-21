// Records the same camera stream the pose engine reads, with a sidecar timeline of what the app knew.
import { cameraStream } from '../sensing/camera'
import { senses, type SenseState } from '../sensing/senses'
import { KEYPOINTS } from '../sensing/types'
import { getSettings } from '../store/settings'
import { enforceCap, saveClip, type ClipRow } from './clipStore'

export const APP_VERSION = '0.2.0'
const CHUNK_SEC = 300   // a session is saved as consecutive 5-minute clips

export interface Context { mode: string; videoId: string | null; tag: string | null }

/**
 * What was on the screen at this instant. For now this is a *reference* that lets the Mac rebuild the frame:
 * a content id plus playback time, or the game's state. It is a stand-in. Once we own the content or can capture
 * the display, `kind: 'capture'` will point into a recorded screen video instead, and that is the real solution;
 * anything reading timelines must switch on `kind` and not assume a reference.
 */
export type ScreenRef =
  | { kind: 'youtube' | 'file'; id: string; ref: string; t: number | null; dur: number | null; state: string }
  | { kind: 'game'; id: string; target: [number, number, number]; hits: number }   // target = x, y, radius, all as fractions of the screen
  | { kind: 'rest' | 'pick' | 'none' }
  | { kind: 'capture'; clip: string; t: number }
type TimelineEntry =
  | { t: number; type: 'pose'; mode: string; videoId: string | null; att: number; arousal: string; score: number; ptr?: number[]; raw?: number[]; yaw?: number; neutral?: number; yawUsed?: boolean; ref?: string | null; prox?: number; inferMs?: number; box?: number[]; kpts?: number[][]; screen?: ScreenRef }
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
  private running = false
  private sessionId = ''
  private chunk = 0
  private probe: (() => ScreenRef) | null = null
  private ctx: Context = { mode: 'rest', videoId: null, tag: null }
  private unsub: (() => void) | null = null
  private audioTrack: MediaStreamTrack | null = null
  onSaved: ((row: ClipRow) => void) | null = null
  get active() { return this.running }
  get capturing() { return !!this.rec }

  /** Records the whole session, camera and (unless turned off) sound, as consecutive clips. */
  async start(sessionId = `s-${Date.now()}`) {
    if (this.running) return
    this.sessionId = sessionId; this.chunk = 0
    if (getSettings().recordSound) {
      // raw microphone: barks and whines are signal, and the speaker bleed gives a sync check against the video
      try { this.audioTrack = (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })).getAudioTracks()[0] } catch { this.audioTrack = null }
    }
    this.running = true
    this.unsub = senses.subscribe((st) => this.onSense(st))
    this.begin('session', CHUNK_SEC)
  }

  /** DogMode supplies this; it is asked once per logged frame. */
  setScreenProbe(fn: (() => ScreenRef) | null) { this.probe = fn }

  async stop() {
    this.running = false
    this.unsub?.(); this.unsub = null
    await this.end()
    this.audioTrack?.stop(); this.audioTrack = null
  }

  /** One continuous clip outside a dog session (used by the pointer test). Stop it with `stop()`. */
  async startManual(trigger: string, maxSec = 300) {
    if (this.running) await this.stop()
    this.sessionId = `${trigger}-${Date.now()}`; this.chunk = 0
    this.running = true
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
    if (this.rec) this.timeline.push({ t: this.now(), type: 'touch', x: +nx.toFixed(3), y: +ny.toFixed(3), mode: this.ctx.mode })
  }

  private now() { return Math.round(performance.now() - this.clipStart) }

  private onSense(st: SenseState) {
    if (!this.rec) return
    const r = (v: number) => +v.toFixed(4)
    this.timeline.push({
      t: this.now(), type: 'pose', mode: this.ctx.mode, videoId: this.ctx.videoId, att: r(st.attention), arousal: st.arousal, score: r(st.pose?.score ?? 0),
      ptr: st.nose ? [r(st.nose.x), r(st.nose.y)] : undefined, raw: st.rawNose ? [r(st.rawNose.x), r(st.rawNose.y)] : undefined,
      yaw: r(st.yaw), neutral: r(st.neutralYaw), yawUsed: st.yawUsed, ref: st.ref, prox: r(st.proximity), inferMs: Math.round(st.inferMs),
      box: st.pose ? [r(st.pose.box.x), r(st.pose.box.y), r(st.pose.box.w), r(st.pose.box.h)] : undefined,
      kpts: st.pose?.kpts.map((k) => [r(k.x), r(k.y), +k.c.toFixed(2)]),
      screen: this.probe?.(),
    })
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
        if (video.size > 0 && durSec > 1) {
          try { await saveClip(row, video, this.meta(row)); await enforceCap(getSettings().storageCapMB); this.onSaved?.(row) } catch (e) { console.warn('clip save failed', e) }
        }
        if (rollover && this.running) this.begin(this.trigger, CHUNK_SEC)
        resolve()
      }
      try { rec.stop() } catch { resolve() }
    })
  }

  private meta(row: ClipRow) {
    const s = getSettings(), vs = cameraStream()?.getVideoTracks()[0]?.getSettings()
    return {
      format: 'dogos-clip/2', appVersion: APP_VERSION, clipId: row.id, sessionId: this.sessionId, chunk: this.chunk++, dogName: s.dogName, startedAt: new Date(row.start).toISOString(),
      durationSec: +row.durSec.toFixed(2), trigger: row.trigger, mime: row.mime, hasAudio: row.hasAudio,
      device: { userAgent: navigator.userAgent, screen: [screen.width, screen.height], dpr: devicePixelRatio, orientation: screen.orientation?.type ?? '' },
      camera: { width: vs?.width, height: vs?.height, frameRate: vs?.frameRate, facingMode: vs?.facingMode, mirrored: false },
      model: { state: senses.state.model, ...senses.modelInfo, keypoints: KEYPOINTS, coords: 'normalized 0..1 in the un-mirrored camera frame; touches are normalized screen coords' },
      timeline: this.timeline,
    }
  }
}

export const recorder = new ClipRecorder()
