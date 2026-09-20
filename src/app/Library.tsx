import { useEffect, useMemo, useState } from 'react'
import { emptyBandit, mean, type BanditState } from '../brain/bandit'
import { getEmbedder, suggestTags } from '../brain/embedder'
import { rank } from '../brain/similarity'
import { TAGS, addCustomVideo, getFlags, loadCatalog, parseYouTubeId, removeCustomVideo, setFlags, thumb, verifyYouTube, type Flags, type Video } from '../content/catalog'
import { kvGet } from '../store/db'

export function Library() {
  const [videos, setVideos] = useState<Video[]>([])
  const [flags, setF] = useState<Flags>({ pinned: [], blocked: [], failed: {} })
  const [bandit, setBandit] = useState<BanditState>(emptyBandit())
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<string[] | null>(null)
  const [searching, setSearching] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = async () => { setVideos(await loadCatalog(true)); setF(await getFlags()); setBandit(await kvGet('bandit', emptyBandit())) }
  useEffect(() => { void refresh() }, [])

  const hasEmbeddings = videos.some((v) => v.embedding)
  const search = async () => {
    const text = q.trim()
    if (!text) return setOrder(null)
    const words = text.toLowerCase().split(/\s+/)
    const keyword = videos.filter((v) => words.every((w) => (v.title + ' ' + v.tags.join(' ') + ' ' + (v.channel ?? '')).toLowerCase().includes(w))).map((v) => v.id)
    if (!hasEmbeddings) return setOrder(keyword)
    try {
      setSearching('Loading the search model (about 24 MB, first time only)…')
      const e = await getEmbedder(); setSearching('Searching…')
      const ranked = rank(await e.text('a video of ' + text), videos).map((r) => r.item.id)
      setOrder([...new Set([...keyword, ...ranked])].slice(0, 12))
    } catch { setOrder(keyword) } finally { setSearching('') }
  }

  const shown = useMemo(() => (order ? order.map((id) => videos.find((v) => v.id === id)!).filter(Boolean) : videos), [order, videos])
  const toggle = async (key: 'pinned' | 'blocked', id: string) => {
    const has = flags[key].includes(id), next = { ...flags, [key]: has ? flags[key].filter((x) => x !== id) : [...flags[key], id] }
    setF(next); await setFlags(next)
  }
  const credits = videos.filter((v) => v.license)
  return (
    <div className="library">
      <form className="search" onSubmit={(e) => { e.preventDefault(); void search() }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setOrder(null) }} placeholder="🔍 birds in snow" enterKeyHint="search" />
      </form>
      {searching && <p className="note">{searching}</p>}
      <ul className="videos">
        {shown.map((v) => {
          const b = bandit.items[v.id], score = b && b.a + b.b > 2.2 ? mean(b) : null, failed = (flags.failed[v.id] ?? 0) >= 3
          return (
            <li key={v.id} className={flags.blocked.includes(v.id) ? 'blocked' : ''}>
              {thumb(v) ? <img src={thumb(v)!} alt="" loading="lazy" /> : <div className="thumb-file">file</div>}
              <div className="v-body">
                <strong>{v.title}</strong>
                <span className="muted">{v.tags.join(' · ')}{failed ? ' · won’t play' : ''}</span>
                <span className="meter"><i style={{ width: `${(score ?? 0) * 100}%` }} /><em>{score === null ? 'not watched yet' : score.toFixed(2)}</em></span>
              </div>
              <div className="v-actions">
                <button onClick={() => toggle('pinned', v.id)} aria-label="favorite">{flags.pinned.includes(v.id) ? '★' : '☆'}</button>
                <button onClick={() => toggle('blocked', v.id)} aria-label="never play" className={flags.blocked.includes(v.id) ? 'on' : ''}>⊘</button>
                {v.custom && <button onClick={async () => { await removeCustomVideo(v.id); void refresh() }} aria-label="remove">✕</button>}
              </div>
            </li>
          )
        })}
      </ul>
      {adding ? <AddVideo done={() => { setAdding(false); void refresh() }} /> : <button className="primary" onClick={() => setAdding(true)}>+ Paste a YouTube link</button>}
      {!!credits.length && (
        <details className="credits"><summary>Credits for bundled clips</summary>
          <ul>{credits.map((v) => <li key={v.id}>{v.title}, {v.channel}, {v.license}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function AddVideo({ done }: { done: () => void }) {
  const [url, setUrl] = useState('')
  const [found, setFound] = useState<{ id: string; title: string; channel: string } | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const check = async () => {
    const id = parseYouTubeId(url)
    if (!id) return setMsg('That doesn’t look like a YouTube link.')
    setMsg('Checking…')
    const info = await verifyYouTube(id)
    if (!info) return setMsg('YouTube says that video can’t be embedded, or it doesn’t exist.')
    setFound({ id, ...info }); setMsg('Suggesting tags…')
    try { setTags(await suggestTags({ source: 'youtube', ref: id }, TAGS)) } catch { /* model offline: pick tags by hand */ }
    setMsg('')
  }
  const save = async () => {
    if (!found) return
    await addCustomVideo({ id: 'yt-' + found.id, source: 'youtube', ref: found.id, title: found.title, channel: found.channel, tags: tags.length ? tags : ['nature-sounds'], durationSec: null })
    done()
  }
  return (
    <div className="add">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" inputMode="url" />
      {!found && <div className="two"><button onClick={done}>Cancel</button><button className="primary" onClick={check}>Check</button></div>}
      {msg && <p className="note">{msg}</p>}
      {found && (
        <>
          <strong>{found.title}</strong>
          <div className="chips">{TAGS.map((t) => <button key={t} className={tags.includes(t) ? 'on' : ''} onClick={() => setTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]))}>{t}</button>)}</div>
          <div className="two"><button onClick={done}>Cancel</button><button className="primary" onClick={save}>Save</button></div>
        </>
      )}
    </div>
  )
}
