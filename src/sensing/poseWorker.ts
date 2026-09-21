/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import { decodePose, letterbox } from './decode'

type InMsg = { type: 'init'; base: string } | { type: 'frame'; bitmap: ImageBitmap; t: number }

let session: ort.InferenceSession | null = null
let size = 320, K = 10, conf = 0.35, inputName = 'images'
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let chw: Float32Array | null = null

async function init(base: string) {
  ort.env.wasm.wasmPaths = base + 'ort/'
  ort.env.wasm.numThreads = 1   // GitHub Pages can't send COOP/COEP, so no SharedArrayBuffer threads
  try {
    const meta = await fetch(base + 'models/dogpose.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (meta) {
      size = meta.inputSize ?? meta.input?.shape?.[2] ?? size
      K = meta.keypoints?.length ?? K
      conf = meta.recommendedConfThreshold ?? meta.confThreshold ?? conf
    }
    const file = meta?.model ?? meta?.file ?? 'dogpose.onnx'
    const res = await fetch(base + 'models/' + file)
    if (!res.ok) throw new Error('no model (' + res.status + ')')
    const buf = await res.arrayBuffer()
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    inputName = session.inputNames[0]
    canvas = new OffscreenCanvas(size, size)
    ctx = canvas.getContext('2d', { willReadFrequently: true })
    chw = new Float32Array(3 * size * size)
    postMessage({ type: 'ready', size, K, info: { file, baseModel: meta?.baseModel ?? null, bytes: buf.byteLength, lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag') } })
  } catch (e) {
    postMessage({ type: 'unavailable', reason: String((e as Error).message ?? e) })
  }
}

async function run(bitmap: ImageBitmap, t: number) {
  if (!session || !ctx || !chw) { bitmap.close(); return }
  const t0 = performance.now()
  const lb = letterbox(bitmap.width, bitmap.height, size)
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, lb.padX, lb.padY, bitmap.width * lb.scale, bitmap.height * lb.scale)
  bitmap.close()
  const px = ctx.getImageData(0, 0, size, size).data
  const n = size * size
  for (let i = 0; i < n; i++) { chw[i] = px[i * 4] / 255; chw[n + i] = px[i * 4 + 1] / 255; chw[2 * n + i] = px[i * 4 + 2] / 255 }
  const out = await session.run({ [inputName]: new ort.Tensor('float32', chw, [1, 3, size, size]) })
  const o = out[session.outputNames[0]]
  const pose = decodePose(o.data as Float32Array, o.dims, K, lb, conf)
  postMessage({ type: 'pose', t, pose, inferMs: performance.now() - t0 })
}

let busy = false
self.onmessage = async (e: MessageEvent<InMsg>) => {
  const m = e.data
  if (m.type === 'init') return init(m.base)
  if (busy) { m.bitmap.close(); return }
  busy = true
  try { await run(m.bitmap, m.t) } catch (err) { postMessage({ type: 'error', reason: String(err) }) } finally { busy = false }
}
