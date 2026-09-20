export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na * nb) + 1e-12)
}
export function normalize(v: Float32Array): Float32Array {
  let n = 0; for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}
export function centroid(vs: Float32Array[]): Float32Array | null {
  if (!vs.length) return null
  const out = new Float32Array(vs[0].length)
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i]
  return normalize(out)
}
/** Embeddings travel in catalog.json as base64 float16 to keep the file small. */
export function decodeF16(b64: string): Float32Array {
  const bin = atob(b64), u16 = new Uint16Array(bin.length / 2)
  for (let i = 0; i < u16.length; i++) u16[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
  const out = new Float32Array(u16.length)
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff
    out[i] = e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024)
  }
  return out
}
export function encodeF16(v: Float32Array): string {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
  let bin = ''
  for (const x of v) {
    f32[0] = x
    const b = u32[0], s = (b >> 16) & 0x8000, e = ((b >> 23) & 0xff) - 127 + 15, f = b & 0x7fffff
    let h: number
    if (e <= 0) h = s | (e < -10 ? 0 : ((f | 0x800000) >> (1 - e + 13)))
    else if (e >= 31) h = s | 0x7c00
    else h = s | (e << 10) | (f >> 13)
    bin += String.fromCharCode(h & 0xff, (h >> 8) & 0xff)
  }
  return btoa(bin)
}
export function rank<T extends { embedding?: Float32Array }>(query: Float32Array, items: T[]): { item: T; score: number }[] {
  return items.filter((i) => i.embedding).map((item) => ({ item, score: cosine(query, item.embedding!) })).sort((a, b) => b.score - a.score)
}
