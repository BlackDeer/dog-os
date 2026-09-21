// All sounds are synthesized, short, and capped. Nothing here should startle a dog.
let ctx: AudioContext | null = null
let master: GainNode | null = null
let cap = 0.5

export function unlockAudio() {
  ctx ??= new AudioContext()
  if (!master) { master = ctx.createGain(); master.gain.value = cap; master.connect(ctx.destination) }
  if (ctx.state === 'suspended') void ctx.resume()
}
export function setVolumeCap(v: number) { cap = v; if (master) master.gain.value = v }

function tone(freq0: number, freq1: number, dur: number, type: OscillatorType, peak: number) {
  if (!ctx || !master) return
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type; o.frequency.setValueAtTime(freq0, t); o.frequency.exponentialRampToValueAtTime(freq1, t + dur)
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02)
}
export const ripple = () => tone(520, 380, 0.22, 'sine', 0.25)
export const squeak = () => { tone(900, 1500, 0.09, 'triangle', 0.4); setTimeout(() => tone(1500, 800, 0.12, 'triangle', 0.35), 80) }
export const boing = () => tone(260, 520, 0.16, 'sine', 0.35)
export const chime = () => { tone(660, 660, 0.25, 'sine', 0.3); setTimeout(() => tone(880, 880, 0.35, 'sine', 0.3), 120) }
/** Quiet brown-noise bed for REST and for offline fallback. */
let bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null
export function ambient(on: boolean) {
  if (!ctx || !master) return
  if (!on) { if (bed) { const b = bed; bed = null; b.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2); setTimeout(() => b.src.stop(), 2200) } return }
  if (bed) return
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 }
  const src = ctx.createBufferSource(), gain = ctx.createGain()
  src.buffer = buf; src.loop = true; gain.gain.value = 0
  gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 3)
  src.connect(gain).connect(master); src.start(); bed = { src, gain }
}
