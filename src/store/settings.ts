import { useSyncExternalStore } from 'react'

export type Preset = 'calm' | 'birds' | 'games' | 'everything'
export interface Settings {
  dogName: string
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
  devMode: boolean
  showHud: boolean
  wizardDone: boolean
}

export const DEFAULTS: Settings = {
  dogName: 'Niles', volumeCap: 0.5, rotateAfterSec: 45, preset: 'calm', fileOnly: false, noseCursor: true, showCursor: true, showMonitor: true, pickScreen: false,
  record: true, recordMode: 'auto', recordAudio: false, storageCapMB: 500,
  devMode: false, showHud: false, wizardDone: false,
}

const KEY = 'dogos.settings.v2'   // v2: simplified settings; old blobs are dropped except for setup completion
let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (stored) return { ...DEFAULTS, ...stored }
    const v1 = JSON.parse(localStorage.getItem('dogos.settings.v1') ?? 'null')
    return { ...DEFAULTS, wizardDone: !!v1?.wizardDone }
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
