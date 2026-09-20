// Clips live in OPFS (falls back to IndexedDB blobs). Index rows live in IndexedDB.
import { all, del, get, put } from '../store/db'

export interface ClipRow { id: string; start: number; durSec: number; bytes: number; shared: boolean; trigger: string; mime: string; hasAudio: boolean }

const opfs = async (): Promise<FileSystemDirectoryHandle | null> => {
  try { return await (await navigator.storage.getDirectory()).getDirectoryHandle('clips', { create: true }) } catch { return null }
}
const ext = (mime: string) => (mime.includes('mp4') ? 'mp4' : 'webm')

export async function saveClip(row: ClipRow, video: Blob, meta: object) {
  const dir = await opfs()
  const metaBlob = new Blob([JSON.stringify(meta)], { type: 'application/json' })
  if (dir) {
    for (const [name, blob] of [[`${row.id}.${ext(row.mime)}`, video], [`${row.id}.json`, metaBlob]] as const) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(blob); await w.close()
    }
  } else {
    await put('kv', video, `clipvideo:${row.id}`); await put('kv', metaBlob, `clipmeta:${row.id}`)
  }
  await put('clips', row)
  void navigator.storage?.persist?.()
}

export async function readClip(row: ClipRow): Promise<{ video: Blob; meta: Blob } | null> {
  const dir = await opfs()
  try {
    if (dir) {
      const video = await (await dir.getFileHandle(`${row.id}.${ext(row.mime)}`)).getFile()
      const meta = await (await dir.getFileHandle(`${row.id}.json`)).getFile()
      return { video, meta }
    }
  } catch { /* fall through to IDB */ }
  const video = await get<Blob>('kv', `clipvideo:${row.id}`), meta = await get<Blob>('kv', `clipmeta:${row.id}`)
  return video && meta ? { video, meta } : null
}

export async function deleteClip(row: ClipRow) {
  const dir = await opfs()
  for (const name of [`${row.id}.${ext(row.mime)}`, `${row.id}.json`]) { try { await dir?.removeEntry(name) } catch { /* already gone */ } }
  await del('kv', `clipvideo:${row.id}`); await del('kv', `clipmeta:${row.id}`); await del('clips', row.id)
}

export const listClips = async () => (await all<ClipRow>('clips')).sort((a, b) => b.start - a.start)
export const markShared = (rows: ClipRow[]) => Promise.all(rows.map((r) => put('clips', { ...r, shared: true })))

/** Which clips to drop to get under the cap: already-shared ones first (they exist elsewhere), then oldest. */
export function evictionOrder(rows: ClipRow[], capBytes: number): ClipRow[] {
  let total = rows.reduce((s, r) => s + r.bytes, 0)
  const order = [...rows].sort((a, b) => Number(b.shared) - Number(a.shared) || a.start - b.start)
  const out: ClipRow[] = []
  for (const r of order) { if (total <= capBytes) break; out.push(r); total -= r.bytes }
  return out
}
export async function enforceCap(capMB: number) { for (const r of evictionOrder(await listClips(), capMB * 1024 * 1024)) await deleteClip(r) }
