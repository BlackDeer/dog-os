// Tiny IndexedDB wrapper. Everything the dashboard shows comes from here; nothing leaves the device.
const DB = 'dogos', VERSION = 1
export interface PlayRecord {
  id?: number; sessionId: string; kind: 'video' | 'game'; itemId: string; tag: string; start: number
  durSec: number; meanAttention: number; meanReward: number; touches: number; workedUpSec: number
}
export interface SessionRecord { id: string; start: number; end: number; activeSec: number; preset: string }
export interface TrainingRecord { id?: number; cue: string; day: string; reps: number; misses: number }

let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('sessions', { keyPath: 'id' })
      db.createObjectStore('plays', { keyPath: 'id', autoIncrement: true }).createIndex('start', 'start')
      db.createObjectStore('training', { keyPath: 'id', autoIncrement: true }).createIndex('day', 'day')
      db.createObjectStore('kv')
      db.createObjectStore('clips', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}
const wrap = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
async function store(name: string, mode: IDBTransactionMode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name) }

export const put = async <T>(name: string, value: T, key?: IDBValidKey) => wrap((await store(name, 'readwrite')).put(value as never, key))
export const get = async <T>(name: string, key: IDBValidKey) => wrap<T | undefined>((await store(name)).get(key))
export const all = async <T>(name: string) => wrap<T[]>((await store(name)).getAll())
export const del = async (name: string, key: IDBValidKey) => wrap((await store(name, 'readwrite')).delete(key))
export const kvGet = async <T>(key: string, fallback: T): Promise<T> => ((await get<T>('kv', key)) ?? fallback)
export const kvSet = <T>(key: string, value: T) => put('kv', value, key)

export async function playsSince(ts: number): Promise<PlayRecord[]> {
  const s = await store('plays')
  return wrap<PlayRecord[]>(s.index('start').getAll(IDBKeyRange.lowerBound(ts)))
}
export const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
