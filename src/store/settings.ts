import { useSyncExternalStore } from 'react'
import { DEFAULT_CAL, type NoseCalibration } from '../sensing/noseZones'

export type Preset = 'calm' | 'birds' | 'games' | 'everything'
export interface Settings {
  dogName: string
  sessionMin: number
  restMin: number
  quietOn: boolean
  quietStart: string   // "22:00"
  quietEnd: string     // "07:00"
  volumeCap: number    // 0..1
  rotateAfterSec: number
  preset: Preset
  fileOnly: boolean
  noseCursor: boolean     // camera pointing as an input
  showCursor: boolean     // draw the pointer where the dog can see it
  showMonitor: boolean    // live attention readout, top-right of dog mode (temporary, for pre-screening)
  pickScreen: boolean
  record: boolean
  recordMode: 'auto' | 'full' | 'snippets'
  recordAudio: boolean
  storageCapMB: number
  mountNote: string
  devMode: boolean
  showHud: boolean
  calibration: NoseCalibration
  neutralYaw: number | null
  wizardDone: boolean
}

export const DEFAULTS: Settings = {
  dogName: 'Niles', sessionMin: 30, restMin: 60, quietOn: true, quietStart: '22:00', quietEnd: '07:00',
  volumeCap: 0.5, rotateAfterSec: 45, preset: 'calm', fileOnly: false, noseCursor: true, showCursor: true, showMonitor: true, pickScreen: false,
  record: false, recordMode: 'auto', recordAudio: false, storageCapMB: 500, mountNote: '',
  devMode: false, showHud: false, calibration: DEFAULT_CAL, neutralYaw: null, wizardDone: false,
}

const KEY = 'dogos.settings.v1'
let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    // settings saved before the visible cursor existed had the nose cursor off by default; it is on now
    if (!('showCursor' in stored)) delete stored.noseCursor
    return { ...DEFAULTS, ...stored }
  } catch { return { ...DEFAULTS } }
}

export const getSettings = () => current
export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* private mode */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useSettings = () => useSyncExternalStore(subscribe, getSettings)

export function inQuietHours(s: Settings, d = new Date()): boolean {
  if (!s.quietOn) return false
  const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0) }
  const now = d.getHours() * 60 + d.getMinutes(), a = mins(s.quietStart), b = mins(s.quietEnd)
  return a <= b ? now >= a && now < b : now >= a || now < b
}
