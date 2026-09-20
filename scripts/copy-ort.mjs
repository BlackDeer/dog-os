// Copies the onnxruntime-web WASM runtime into public/ort so it is served from our own origin
// (GitHub Pages) and precached for offline use.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
const src = 'node_modules/onnxruntime-web/dist'
const dst = 'public/ort'
mkdirSync(dst, { recursive: true })
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  if (!existsSync(`${src}/${f}`)) throw new Error(`missing ${src}/${f}`)
  cpSync(`${src}/${f}`, `${dst}/${f}`)
}
console.log('copied onnxruntime wasm -> public/ort')
