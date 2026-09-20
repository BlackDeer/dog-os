// Fullscreen + wake lock. Both need a user gesture the first time; the wake lock is re-acquired whenever the page returns.
let lock: WakeLockSentinel | null = null
let wanted = false

async function acquire() {
  if (!wanted || document.visibilityState !== 'visible') return
  try { lock = await navigator.wakeLock?.request('screen') ?? null } catch { lock = null }
}
document.addEventListener('visibilitychange', () => { if (wanted && (!lock || lock.released)) void acquire() })

export async function enterKiosk() {
  wanted = true
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }) } catch { /* iOS / denied */ }
  try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape') } catch { /* desktop or not allowed */ }
  await acquire()
}
export async function exitKiosk() {
  wanted = false
  try { await lock?.release() } catch { /* ignore */ }
  lock = null
  try { (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.() } catch { /* ignore */ }
  try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* ignore */ }
}
