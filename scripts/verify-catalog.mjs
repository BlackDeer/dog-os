#!/usr/bin/env node
// Verifies public/catalog.json. Node 20+, zero dependencies.
//   node scripts/verify-catalog.mjs            schema + network checks
//   node scripts/verify-catalog.mjs --offline  schema checks only
// Exits 1 on any failure.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OFFLINE = process.argv.includes('--offline');
const CONCURRENCY = 5;
const TIMEOUT_MS = 20_000;
// Wikimedia's User-Agent policy wants a contact URL or email in the UA. Without one,
// upload.wikimedia.org answers almost every request with 429. Override with VERIFY_UA.
const UA = process.env.VERIFY_UA ?? 'dog-os-verify-catalog/1.0 (+https://github.com/BlackDeer)';
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIDEO_TYPE = /^(video\/|application\/ogg)/i;

const catalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'catalog.json',
);

// ---------- schema ----------

function checkSchema(catalog) {
  const top = [];
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { top: ['catalog must be an object'], perEntry: new Map() };
  }
  if (catalog.version !== 1) top.push('version must be 1');
  if (!Array.isArray(catalog.tags) || catalog.tags.length === 0 || catalog.tags.some((t) => typeof t !== 'string')) {
    top.push('tags must be a non-empty array of strings');
  } else if (new Set(catalog.tags).size !== catalog.tags.length) {
    top.push('tags contains duplicates');
  }
  if (!Array.isArray(catalog.videos) || catalog.videos.length === 0) {
    top.push('videos must be a non-empty array');
    return { top, perEntry: new Map() };
  }

  const known = new Set(Array.isArray(catalog.tags) ? catalog.tags : []);
  const seenIds = new Map();
  const seenRefs = new Map();
  const perEntry = new Map(); // index -> string[]

  catalog.videos.forEach((v, i) => {
    const errs = [];
    perEntry.set(i, errs);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      errs.push('entry must be an object');
      return;
    }
    if (typeof v.id !== 'string' || !SLUG.test(v.id)) errs.push('id must be a lowercase slug');
    else if (seenIds.has(v.id)) errs.push(`duplicate id (also at index ${seenIds.get(v.id)})`);
    else seenIds.set(v.id, i);

    if (v.source !== 'youtube' && v.source !== 'file') errs.push('source must be "youtube" or "file"');

    if (typeof v.ref !== 'string' || v.ref.length === 0) errs.push('ref must be a non-empty string');
    else {
      if (v.source === 'youtube' && !YT_ID.test(v.ref)) errs.push('ref is not an 11-char YouTube id');
      if (v.source === 'file') {
        let u = null;
        try { u = new URL(v.ref); } catch { /* handled below */ }
        if (!u || u.protocol !== 'https:') errs.push('ref must be an https URL');
      }
      const key = `${v.source}:${v.ref}`;
      if (seenRefs.has(key)) errs.push(`duplicate ref (also at index ${seenRefs.get(key)})`);
      else seenRefs.set(key, i);
    }

    if (typeof v.title !== 'string' || !v.title.trim()) errs.push('title must be a non-empty string');
    if (typeof v.channel !== 'string' || !v.channel.trim()) errs.push('channel must be a non-empty string');

    if (!Array.isArray(v.tags) || v.tags.length === 0) errs.push('tags must be a non-empty array');
    else {
      for (const t of v.tags) if (!known.has(t)) errs.push(`unknown tag "${t}"`);
      if (new Set(v.tags).size !== v.tags.length) errs.push('duplicate tags');
    }

    if (!(v.durationSec === null || (typeof v.durationSec === 'number' && Number.isFinite(v.durationSec) && v.durationSec > 0))) {
      errs.push('durationSec must be a positive number or null');
    }
    if (typeof v.calm !== 'boolean') errs.push('calm must be boolean');

    if (v.source === 'file' && (typeof v.license !== 'string' || !v.license.trim())) {
      errs.push('file sources need a license');
    }
    if (v.source === 'youtube' && 'license' in v) errs.push('license is for file sources only');
  });

  // every declared tag should have at least one video
  if (Array.isArray(catalog.tags)) {
    for (const t of catalog.tags) {
      if (!catalog.videos.some((v) => Array.isArray(v?.tags) && v.tags.includes(t))) top.push(`tag "${t}" has no videos`);
    }
  }
  return { top, perEntry };
}

// ---------- network ----------

async function fetchT(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...init,
      headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries once, only when fetch itself throws (network error / timeout).
async function withRetry(fn) {
  try {
    return await fn();
  } catch {
    await sleep(1000);
    return await fn();
  }
}

async function checkYouTube(v) {
  const watch = `https://www.youtube.com/watch?v=${v.ref}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
  const res = await withRetry(() => fetchT(url));
  if (res.status !== 200) {
    await res.body?.cancel();
    const why = res.status === 401 || res.status === 403 ? 'embedding disabled or private' : res.status === 404 ? 'not found' : 'unexpected';
    return { ok: false, detail: `oEmbed ${res.status} (${why})` };
  }
  let note = '';
  try {
    const j = await res.json();
    if (j.title && j.title !== v.title) note = ' (title changed upstream)';
  } catch {
    return { ok: false, detail: 'oEmbed 200 but body is not JSON' };
  }
  return { ok: true, detail: `oEmbed 200${note}` };
}

// Rate-limited responses (429/503) get one more try, honouring Retry-After (capped at 15s).
async function fetchPolite(url, init) {
  let res = await withRetry(() => fetchT(url, init));
  if (res.status === 429 || res.status === 503) {
    await res.body?.cancel();
    const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 15);
    await sleep(wait * 1000);
    res = await withRetry(() => fetchT(url, init));
  }
  return res;
}

// File hosts (Wikimedia in particular) answer bursts with 429, so requests to the
// same host run one at a time with a short gap, whatever the global concurrency is.
const hostQueues = new Map();
function perHost(url, fn) {
  const host = new URL(url).host;
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const run = prev.then(fn);
  hostQueues.set(host, run.catch(() => {}).then(() => sleep(500)));
  return run;
}

function checkFile(v) {
  return perHost(v.ref, () => checkFileNow(v));
}

async function checkFileNow(v) {
  let res = await fetchPolite(v.ref, { method: 'HEAD' });
  let how = 'HEAD';
  if (res.status !== 200) {
    // Some hosts refuse HEAD; fall back to a 1-byte ranged GET.
    res = await fetchPolite(v.ref, { headers: { Range: 'bytes=0-0' } });
    how = 'GET range';
    await res.body?.cancel();
    if (res.status !== 200 && res.status !== 206) return { ok: false, detail: `${how} ${res.status}` };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!VIDEO_TYPE.test(type)) return { ok: false, detail: `${how} ${res.status}, content-type "${type}" is not video` };
  const ranges = how === 'GET range' && res.status === 206 ? 'bytes' : (res.headers.get('accept-ranges') ?? 'none');
  const len = res.headers.get('content-range')?.split('/')[1] ?? res.headers.get('content-length');
  const mb = len && Number.isFinite(Number(len)) ? ` ${(Number(len) / 1e6).toFixed(1)}MB` : '';
  const warn = ranges.toLowerCase() === 'bytes' ? '' : ' (no byte ranges: seeking will not work)';
  return { ok: true, detail: `${how} ${res.status} ${type}${mb}${warn}` };
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// ---------- main ----------

function printTable(rows) {
  const head = ['', 'id', 'source', 'ref', 'result'];
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const data = rows.map((r) => [r.ok ? 'ok' : 'FAIL', clip(r.id, 40), r.source, clip(r.ref, 44), r.detail]);
  const widths = head.map((h, c) => Math.max(h.length, ...data.map((d) => d[c].length)));
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const d of data) console.log(line(d));
}

async function main() {
  let catalog;
  try {
    catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${catalogPath}: ${e.message}`);
    process.exit(1);
  }

  const { top, perEntry } = checkSchema(catalog);
  const videos = Array.isArray(catalog?.videos) ? catalog.videos : [];

  const rows = await pool(videos, CONCURRENCY, async (v, i) => {
    const base = { id: String(v?.id ?? `#${i}`), source: String(v?.source ?? '?'), ref: String(v?.ref ?? '') };
    const schemaErrs = perEntry.get(i) ?? [];
    if (schemaErrs.length) return { ...base, ok: false, detail: `schema: ${schemaErrs.join('; ')}` };
    if (OFFLINE) return { ...base, ok: true, detail: 'schema ok' };
    try {
      const r = v.source === 'youtube' ? await checkYouTube(v) : await checkFile(v);
      return { ...base, ...r };
    } catch (e) {
      return { ...base, ok: false, detail: `network error: ${e?.cause?.code ?? e?.name ?? e}` };
    }
  });

  printTable(rows);

  const tagCounts = Object.fromEntries((catalog?.tags ?? []).map((t) => [t, videos.filter((v) => v?.tags?.includes?.(t)).length]));
  const failed = rows.filter((r) => !r.ok).length;
  console.log('');
  for (const e of top) console.log(`FAIL  catalog: ${e}`);
  console.log(`tags: ${Object.entries(tagCounts).map(([t, n]) => `${t}=${n}`).join(' ')}`);
  console.log(
    `${rows.length} entries (${videos.filter((v) => v?.source === 'youtube').length} youtube, ${videos.filter((v) => v?.source === 'file').length} file), ` +
      `${rows.length - failed} ok, ${failed} failed${top.length ? `, ${top.length} catalog-level error(s)` : ''}` +
      `${OFFLINE ? ' [offline: schema only]' : ''}`,
  );
  process.exit(failed || top.length ? 1 : 0);
}

main();
