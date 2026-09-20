// TinyCLIP through transformers.js. Loaded lazily and only in owner mode; the dog never pays for it.
import type { Video } from '../content/catalog'
import { normalize } from './similarity'

export const CLIP_MODEL = 'onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX'
export interface Embedder { text(q: string): Promise<Float32Array>; image(url: string): Promise<Float32Array> }

let loading: Promise<Embedder> | null = null
export function getEmbedder(): Promise<Embedder> {
  return (loading ??= (async () => {
    const tf = await import('@huggingface/transformers')
    // The published ONNX is one combined graph (both towers, ~24 MB int8), so the unused tower gets a dummy input.
    const [tokenizer, processor, model] = await Promise.all([
      tf.AutoTokenizer.from_pretrained(CLIP_MODEL),
      tf.AutoProcessor.from_pretrained(CLIP_MODEL),
      tf.CLIPModel.from_pretrained(CLIP_MODEL, { dtype: 'q8' }),
    ])
    const tok = (q: string) => tokenizer([q], { padding: 'max_length', max_length: 77, truncation: true })
    const dummyText = tok('a')
    const dummyImage = await processor(new tf.RawImage(new Uint8ClampedArray(224 * 224 * 3).fill(127), 224, 224, 3))
    return {
      async text(q: string) {
        const { text_embeds } = await model({ ...tok(q), ...dummyImage })
        return normalize(Float32Array.from(text_embeds.data as Float32Array))
      },
      async image(url: string) {
        const { image_embeds } = await model({ ...dummyText, ...(await processor(await tf.RawImage.read(url))) })
        return normalize(Float32Array.from(image_embeds.data as Float32Array))
      },
    }
  })().catch((e) => { loading = null; throw e }))
}

/** Zero-shot tag suggestions for a newly pasted video, from its thumbnail. */
export async function suggestTags(v: Pick<Video, 'source' | 'ref'>, tags: string[]): Promise<string[]> {
  if (v.source !== 'youtube') return []
  const e = await getEmbedder()
  const img = await e.image(`https://i.ytimg.com/vi/${v.ref}/hqdefault.jpg`)
  const prompts: Record<string, string> = {
    'nature-sounds': 'a quiet natural landscape', 'trees-forest': 'a forest with trees', birds: 'birds at a bird feeder',
    squirrels: 'a squirrel', 'dogs-playing': 'dogs playing', 'fish-tank': 'fish swimming in an aquarium', rain: 'rain falling', farm: 'farm animals',
  }
  const scored = await Promise.all(tags.map(async (t) => {
    const te = await e.text('a video of ' + (prompts[t] ?? t)); let s = 0
    for (let i = 0; i < te.length; i++) s += te[i] * img[i]
    return { t, s }
  }))
  scored.sort((a, b) => b.s - a.s)
  return scored.filter((x, i) => i === 0 || x.s > scored[0].s - 0.02).slice(0, 2).map((x) => x.t)
}
