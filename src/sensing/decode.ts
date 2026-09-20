import type { DogPose, Keypoint } from './types'

export interface Letterbox { scale: number; padX: number; padY: number; size: number; srcW: number; srcH: number }

export function letterbox(srcW: number, srcH: number, size: number): Letterbox {
  const scale = Math.min(size / srcW, size / srcH)
  return { scale, padX: (size - srcW * scale) / 2, padY: (size - srcH * scale) / 2, size, srcW, srcH }
}

const unX = (x: number, lb: Letterbox) => Math.max(0, Math.min(1, (x - lb.padX) / lb.scale / lb.srcW))
const unY = (y: number, lb: Letterbox) => Math.max(0, Math.min(1, (y - lb.padY) / lb.scale / lb.srcH))

function iou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)
}

/**
 * Decodes a YOLO pose head into the single best dog. Handles both export styles:
 *  - end-to-end (NMS-free): dims [1, N, 6 + K*3], rows = x1,y1,x2,y2,conf,cls,kpts...
 *  - raw:                   dims [1, 4 + nc + K*3, A], columns = cx,cy,w,h,cls...,kpts...  (needs NMS)
 * Coordinates are in letterboxed input pixels.
 */
export function decodePose(data: Float32Array, dims: readonly number[], K: number, lb: Letterbox, confThresh = 0.35, nc = 1): DogPose | null {
  const kLen = K * 3
  const mk = (box: number[], score: number, kp: (i: number) => [number, number, number]): DogPose => {
    const kpts: Keypoint[] = []
    for (let i = 0; i < K; i++) { const [x, y, c] = kp(i); kpts.push({ x: unX(x, lb), y: unY(y, lb), c }) }
    const x1 = unX(box[0], lb), y1 = unY(box[1], lb), x2 = unX(box[2], lb), y2 = unY(box[3], lb)
    return { box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, score, kpts }
  }
  if (dims.length === 3 && dims[2] === 6 + kLen) {
    const N = dims[1], W = dims[2]
    let best = -1, bestS = confThresh
    for (let i = 0; i < N; i++) { const s = data[i * W + 4]; if (s > bestS) { bestS = s; best = i } }
    if (best < 0) return null
    const o = best * W
    return mk([data[o], data[o + 1], data[o + 2], data[o + 3]], bestS, (i) => [data[o + 6 + i * 3], data[o + 7 + i * 3], data[o + 8 + i * 3]])
  }
  if (dims.length === 3 && dims[1] === 4 + nc + kLen) {
    const A = dims[2]
    const at = (c: number, a: number) => data[c * A + a]
    const cands: { a: number; s: number; box: number[] }[] = []
    for (let a = 0; a < A; a++) {
      let s = 0
      for (let c = 0; c < nc; c++) s = Math.max(s, at(4 + c, a))
      if (s < confThresh) continue
      const cx = at(0, a), cy = at(1, a), w = at(2, a), h = at(3, a)
      cands.push({ a, s, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] })
    }
    if (!cands.length) return null
    cands.sort((p, q) => q.s - p.s)
    // We only need the top dog, so NMS reduces to "take the best"; keep the loop for a future multi-dog mode.
    const keep: typeof cands = []
    for (const c of cands) { if (keep.every((k) => iou(k.box, c.box) < 0.5)) keep.push(c); if (keep.length >= 3) break }
    const top = keep[0]
    return mk(top.box, top.s, (i) => [at(4 + nc + i * 3, top.a), at(5 + nc + i * 3, top.a), at(6 + nc + i * 3, top.a)])
  }
  throw new Error(`unrecognized pose output dims [${dims.join(',')}] for K=${K}`)
}
