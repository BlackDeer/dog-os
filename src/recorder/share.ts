import { zipSync } from 'fflate'
import { markShared, readClip, type ClipRow } from './clipStore'

/** The zip is the contract with the Mac-side ingest script: `<id>.webm` + `<id>.json` pairs. */
export async function buildZip(rows: ClipRow[]): Promise<File> {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const row of rows) {
    const c = await readClip(row)
    if (!c) continue
    const ext = row.mime.includes('mp4') ? 'mp4' : 'webm'
    files[`${row.id}.${ext}`] = [new Uint8Array(await c.video.arrayBuffer()), { level: 0 }]   // video is already compressed
    files[`${row.id}.json`] = [new Uint8Array(await c.meta.arrayBuffer()), { level: 6 }]
  }
  const name = rows.length === 1 ? `${rows[0].id}.zip` : `dogos-clips-${new Date().toISOString().slice(0, 10)}-${rows.length}.zip`
  return new File([zipSync(files) as BlobPart], name, { type: 'application/zip' })
}

export interface ClipSink { send(rows: ClipRow[]): Promise<'shared' | 'downloaded' | 'cancelled'> }

/** v1 sink: the OS share sheet (Drive, Quick Share, email), or a plain download where file sharing isn't supported. */
export const shareSink: ClipSink = {
  async send(rows) {
    const file = await buildZip(rows)
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Dog OS clips' }) } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; return download(file, rows) }
      await markShared(rows); return 'shared'
    }
    return download(file, rows)
  },
}
async function download(file: File, rows: ClipRow[]) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file); a.download = file.name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  await markShared(rows)
  return 'downloaded' as const
}
