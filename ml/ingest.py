"""Unpack recorder zips from ml/inbox/ into ml/data/raw/<dog>/<clip>/ and extract de-duplicated frames.

  ml/.venv/bin/python ml/ingest.py [--fps 2] [--hash-dist 4] [--force]

A zip holds either  clip.webm + meta.json  or several  <name>.webm + <name>.json  pairs (any folder depth).
Result per clip:  clip.webm, meta.json, frames/<dog>__<clip>__000123.jpg, frames.json (frame -> time in s).
Idempotent: a clip whose frames.json exists is skipped unless --force.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

from common import INBOX, RAW, die

VIDEO_EXT = {".webm", ".mp4", ".mkv", ".mov"}


def slug(s: str, default: str) -> str:
    s = re.sub(r"[^A-Za-z0-9-]+", "-", str(s or "")).strip("-").lower()   # no "_" so "__" stays a safe separator
    return s or default


def pairs_in(z: zipfile.ZipFile):
    """-> [(video member, meta member | None, clip name)]"""
    names = [n for n in z.namelist() if not n.endswith("/") and "__MACOSX" not in n and not Path(n).name.startswith("._")]
    vids = [n for n in names if Path(n).suffix.lower() in VIDEO_EXT]
    out = []
    for v in vids:
        pv = Path(v)
        cands = [str(pv.with_suffix(".json")), str(pv.with_name(pv.stem + ".meta.json")), str(pv.with_name("meta.json"))]
        meta = next((c for c in cands if c in names), None)
        out.append((v, meta, pv.stem))
    return out


def extract_frames(video: Path, frames: Path, prefix: str, fps: float) -> list[Path]:
    frames.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vf", f"fps={fps}",
           "-q:v", "2", "-start_number", "0", str(frames / f"{prefix}__%06d.jpg")]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on {video}: {r.stderr.strip()[:400]}")
    return sorted(frames.glob(f"{prefix}__*.jpg"))


def dedupe(files: list[Path], max_dist: int) -> list[Path]:
    """Drop a frame when its perceptual hash is within max_dist bits of the last KEPT frame."""
    import imagehash
    from PIL import Image
    kept, last = [], None
    for f in files:
        with Image.open(f) as im:
            h = imagehash.phash(im)
        if last is not None and (h - last) <= max_dist:
            f.unlink()
            continue
        kept.append(f)
        last = h
    return kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fps", type=float, default=2.0)
    ap.add_argument("--hash-dist", type=int, default=4, help="phash Hamming distance (of 64 bits) treated as a duplicate")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if shutil.which("ffmpeg") is None:
        die("ffmpeg not found on PATH (brew install ffmpeg)")
    INBOX.mkdir(exist_ok=True)
    zips = sorted(INBOX.glob("*.zip"))
    if not zips:
        print(f"nothing to do: no .zip files in {INBOX}")
        return
    total = 0
    for zp in zips:
        try:
            z = zipfile.ZipFile(zp)
        except zipfile.BadZipFile:
            print(f"!! {zp.name}: not a valid zip, skipped")
            continue
        with z:
            pairs = pairs_in(z)
            if not pairs:
                print(f"!! {zp.name}: no video inside, skipped")
                continue
            for vid, meta_name, stem in pairs:
                meta = {}
                if meta_name:
                    try:
                        meta = json.loads(z.read(meta_name))
                    except Exception as e:
                        print(f"!! {zp.name}:{meta_name}: unreadable metadata ({e}); using defaults")
                dog = slug(meta.get("dogName") if isinstance(meta, dict) else None, "unknown")
                clip = slug(stem if stem != "clip" or len(pairs) > 1 else zp.stem, "clip")
                if stem == "clip" and len(pairs) > 1:
                    clip = slug(f"{zp.stem}-{Path(vid).parent.name}", "clip")
                dst = RAW / dog / clip
                if (dst / "frames.json").exists() and not a.force:
                    print(f"== {zp.name}:{vid} -> {dst.relative_to(RAW)} already ingested")
                    continue
                if dst.exists():
                    shutil.rmtree(dst)
                dst.mkdir(parents=True)
                video = dst / ("clip" + Path(vid).suffix.lower())
                video.write_bytes(z.read(vid))
                (dst / "meta.json").write_text(json.dumps(meta, indent=1))
                try:
                    files = extract_frames(video, dst / "frames", f"{dog}__{clip}", a.fps)
                except RuntimeError as e:
                    print(f"!! {e}")
                    continue
                kept = dedupe(files, a.hash_dist)
                index = {f.name: round(int(f.stem.rsplit("__", 1)[1]) / a.fps, 3) for f in kept}
                (dst / "frames.json").write_text(json.dumps(
                    {"source_zip": zp.name, "video": video.name, "fps": a.fps, "extracted": len(files),
                     "kept": len(kept), "frames": index}, indent=1))
                total += len(kept)
                print(f"++ {zp.name}:{vid} -> {dst.relative_to(RAW)}: {len(files)} frames, {len(kept)} kept after de-dup")
    print(f"done: {total} new frames under {RAW}")


if __name__ == "__main__":
    main()
