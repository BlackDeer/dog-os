import { useEffect, useState } from 'react'
import { deleteClip, listClips, readClip, type ClipRow } from '../recorder/clipStore'
import { shareSink } from '../recorder/share'

export function Clips({ back }: { back: () => void }) {
  const [rows, setRows] = useState<ClipRow[]>([])
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [busy, setBusy] = useState('')
  const refresh = () => listClips().then(setRows)
  useEffect(() => { void refresh() }, [])
  useEffect(() => () => { if (playing) URL.revokeObjectURL(playing.url) }, [playing])

  const play = async (r: ClipRow) => { const c = await readClip(r); if (c) setPlaying({ id: r.id, url: URL.createObjectURL(c.video) }) }
  const share = async (list: ClipRow[]) => {
    if (!list.length) return
    setBusy(`Preparing ${list.length} clip${list.length > 1 ? 's' : ''}…`)
    try { const res = await shareSink.send(list); setBusy(res === 'cancelled' ? '' : res === 'shared' ? 'Shared.' : 'Saved to Downloads.') } catch (e) { setBusy('Could not share: ' + (e as Error).message) }
    void refresh()
  }
  const fresh = rows.filter((r) => !r.shared)
  const mb = (b: number) => (b / 1e6).toFixed(1) + ' MB'
  return (
    <div className="clips">
      <header><button className="back" onClick={back}>‹ Today</button><h2>Clips</h2></header>
      <p className="muted">Clips stay on this device until you share them. Share sends a zip to Drive, Quick Share or email; drop it in <code>ml/inbox/</code> on the Mac.</p>
      <button className="primary" disabled={!fresh.length} onClick={() => share(fresh)}>Share all new ({fresh.length})</button>
      {busy && <p className="note">{busy}</p>}
      {!rows.length && <p className="empty">No clips yet. Turn on “Record for training” and start a session.</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <div className="clip-head" onClick={() => play(r)}>
              <strong>{new Date(r.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
              <span>{Math.round(r.durSec)} s · {mb(r.bytes)} · {r.trigger}{r.shared ? ' · shared ✓' : ''}</span>
            </div>
            {playing?.id === r.id && <video src={playing.url} controls autoPlay playsInline muted />}
            <div className="clip-actions">
              <button onClick={() => play(r)}>Play</button>
              <button onClick={() => share([r])}>Share</button>
              <button className="danger" onClick={async () => { await deleteClip(r); void refresh() }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
