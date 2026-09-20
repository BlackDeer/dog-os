// Embeds each catalog video's thumbnails with TinyCLIP (the same model the app uses for text search) and writes
// mean-pooled, L2-normalized vectors into public/catalog.json as base64 float16.
//   node scripts/embed-catalog.mjs [--force]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutoProcessor, AutoTokenizer, CLIPModel, RawImage } from '@huggingface/transformers'

const MODEL = 'onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX'
const FILE = 'public/catalog.json'
const force = process.argv.includes('--force')

const normalize = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n) }
function encodeF16(v) {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer), out = Buffer.alloc(v.length * 2)
  v.forEach((x, i) => {
    f32[0] = x
    const b = u32[0], s = (b >> 16) & 0x8000, e = ((b >> 23) & 0xff) - 127 + 15, f = b & 0x7fffff
    const h = e <= 0 ? s | (e < -10 ? 0 : (f | 0x800000) >> (1 - e + 13)) : e >= 31 ? s | 0x7c00 : s | (e << 10) | (f >> 13)
    out.writeUInt16LE(h & 0xffff, i * 2)
  })
  return out.toString('base64')
}
// YouTube exposes a poster plus three frames sampled through the video
const UA = process.env.VERIFY_UA ?? 'dog-os-embed-catalog/1.0 (+https://github.com/BlackDeer)'
function thumbs(v) {
  if (v.source === 'youtube') return ['hqdefault', 'hq1', 'hq2', 'hq3'].map((n) => `https://i.ytimg.com/vi/${v.ref}/${n}.jpg`)
  // file sources: grab frames with ffmpeg (needs ffmpeg on PATH; skipped quietly if it isn't)
  execFileSync('sleep', ['8'])   // Wikimedia throttles bursts of hotlinked requests
  const dir = mkdtempSync(join(tmpdir(), 'dogos-'))
  const out = []
  for (const [i, at] of [[0, 2], [1, 8]]) {
    const f = join(dir, `${i}.jpg`)
    try { execFileSync('ffmpeg', ['-loglevel', 'error', '-user_agent', UA, '-ss', String(at), '-i', v.ref, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', f]); out.push(f) } catch { /* no frame */ }
  }
  return out
}

const catalog = JSON.parse(readFileSync(FILE, 'utf8'))
const processor = await AutoProcessor.from_pretrained(MODEL)
const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
// The published ONNX is one combined graph (both towers), so the unused tower gets a dummy input.
const model = await CLIPModel.from_pretrained(MODEL, { dtype: 'q8' })
const dummyText = tokenizer(['a'], { padding: 'max_length', max_length: 77, truncation: true })
let done = 0, skipped = 0
for (const v of catalog.videos) {
  if (v.embedding && !force) { skipped++; continue }
  const vecs = []
  for (const url of thumbs(v)) {
    try {
      const img = await RawImage.read(url)
      const { image_embeds } = await model({ ...dummyText, ...(await processor(img)) })
      vecs.push(normalize(Array.from(image_embeds.data)))
    } catch { /* that frame doesn't exist for this video */ }
  }
  if (!vecs.length) { console.log(`- ${v.id}: no thumbnails (${v.source}), left without an embedding`); continue }
  const mean = vecs[0].map((_, i) => vecs.reduce((s, x) => s + x[i], 0) / vecs.length)
  v.embedding = encodeF16(normalize(mean))
  done++
  console.log(`+ ${v.id}: ${vecs.length} frames, dim ${mean.length}`)
}
writeFileSync(FILE, JSON.stringify(catalog, null, 2) + '\n')
console.log(`embedded ${done}, kept ${skipped}, total ${catalog.videos.length}`)

// sanity check: text queries should land on the right tags
const blank = await processor(new RawImage(new Uint8ClampedArray(224 * 224 * 3).fill(127), 224, 224, 3))
for (const q of ['birds at a bird feeder', 'a forest with trees', 'fish swimming in an aquarium', 'rain falling']) {
  const { text_embeds } = await model({ ...tokenizer(['a video of ' + q], { padding: 'max_length', max_length: 77, truncation: true }), ...blank })
  const t = normalize(Array.from(text_embeds.data))
  const top = catalog.videos.filter((v) => v.embedding).map((v) => {
    const b = Buffer.from(v.embedding, 'base64'); let dot = 0
    for (let i = 0; i < t.length; i++) { const h = b.readUInt16LE(i * 2), e = (h >> 10) & 31, f = h & 1023, sgn = h & 0x8000 ? -1 : 1; dot += t[i] * sgn * (e ? 2 ** (e - 15) * (1 + f / 1024) : 2 ** -14 * (f / 1024)) }
    return { tags: v.tags.join('+'), dot }
  }).sort((a, b) => b.dot - a.dot).slice(0, 3)
  console.log(`"${q}" → ${top.map((x) => `${x.tags} (${x.dot.toFixed(2)})`).join(', ')}`)
}
