#!/usr/bin/env python3
"""Analyse pointer behaviour from Dog OS clips. Standard library only.

    python3 ml/analyze_pointer.py                 # every zip in ml/inbox/
    python3 ml/analyze_pointer.py path/to/clip.json path/to/clips.zip

Works on any clip; pointer-test clips (Settings -> Pointer test) add ground truth, so error is reported as well
as shake. Answers: where in the frame does tracking hold up (the "prime zone"), and where does the shake come
from: the nose keypoint itself, the head-turn (yaw) term, dropouts, or the frame rate.
"""
import json, sys, zipfile, statistics as st
from pathlib import Path

def load(paths):
    for p in paths:
        p = Path(p)
        if p.suffix == ".zip":
            with zipfile.ZipFile(p) as z:
                for n in z.namelist():
                    if n.endswith(".json"):
                        yield f"{p.name}:{n}", json.loads(z.read(n))
        elif p.suffix == ".json":
            yield p.name, json.loads(p.read_text())

sd = lambda a: st.pstdev(a) if len(a) > 1 else 0.0
mean = lambda a: st.fmean(a) if a else 0.0
pct = lambda v: f"{v * 100:5.1f}"

def report(name, meta):
    tl = meta.get("timeline", [])
    poses = [e for e in tl if e.get("type") == "pose"]
    marks = [e for e in tl if e.get("type") == "mark"]
    print(f"\n=== {name}  ({meta.get('durationSec')} s, trigger={meta.get('trigger')}, {meta.get('device', {}).get('userAgent', '')[:60]})")
    if not poses:
        print("  no pose entries (tracking model was not loaded during this clip)"); return
    dts = [b["t"] - a["t"] for a, b in zip(poses, poses[1:])]
    dog = [e for e in poses if e.get("kpts")]
    ptr = [e for e in poses if e.get("ptr")]
    print(f"  frames {len(poses)}  rate {1000 / mean(dts):.1f} fps (gap p50 {st.median(dts):.0f} ms, max {max(dts):.0f} ms)  infer {mean([e.get('inferMs', 0) for e in poses]):.0f} ms")
    print(f"  dog found {len(dog) / len(poses):.0%}  pointer shown {len(ptr) / len(poses):.0%}  dropouts (pointer lost then regained) {sum(1 for a, b in zip(poses, poses[1:]) if a.get('ptr') and not b.get('ptr'))}")
    if ptr:
        ears = mean([e.get("ref") == "ears" for e in ptr]); used = mean([bool(e.get("yawUsed")) for e in ptr])
        switches = sum(1 for a, b in zip(ptr, ptr[1:]) if a.get("ref") != b.get("ref"))
        print(f"  head reference: ears {ears:.0%} of the time, {switches} eye<->ear switches; head-turn term active {used:.0%}")

    # frame-to-frame shake, split by source. All in % of screen width.
    def steps(key, idx=0):
        return [abs(b[key][idx] - a[key][idx]) for a, b in zip(poses, poses[1:]) if a.get(key) and b.get(key) and b["t"] - a["t"] < 400]
    nose_steps = [abs(b["kpts"][0][0] - a["kpts"][0][0]) for a, b in zip(poses, poses[1:]) if a.get("kpts") and b.get("kpts") and b["t"] - a["t"] < 400]
    yaw_steps = [abs(b["yaw"] - a["yaw"]) for a, b in zip(poses, poses[1:]) if a.get("yawUsed") and b.get("yawUsed") and b["t"] - a["t"] < 400]
    print("  frame-to-frame movement, median / p90 (% of width):")
    for label, arr in [("smoothed pointer", steps("ptr")), ("raw pointer", steps("raw")), ("nose keypoint (camera frame)", nose_steps)]:
        if arr: print(f"    {label:30s} {pct(st.median(arr))} / {pct(sorted(arr)[int(len(arr) * .9)])}")
    if yaw_steps: print(f"    {'yaw (eye-distance units)':30s} {st.median(yaw_steps):5.2f} / {sorted(yaw_steps)[int(len(yaw_steps) * .9)]:5.2f}   x0.5 gain -> {pct(st.median(yaw_steps) * .5)} % of width per frame")

    # prime zone: keypoint confidence by where the nose is in the camera frame and by distance
    if dog:
        print("  nose confidence by nose position in the camera frame (columns left->right, rows top->bottom):")
        for row in range(3):
            cells = []
            for col in range(3):
                c = [e["kpts"][0][2] for e in dog if int(min(e["kpts"][0][0], .999) * 3) == col and int(min(e["kpts"][0][1], .999) * 3) == row]
                cells.append(f"{mean(c):.2f} (n={len(c):3d})" if c else "  —        ")
            print("    " + "   ".join(cells))
        prox = [e.get("prox", 0) for e in dog if e.get("prox")]
        if prox:
            qs = sorted(prox); cut = [qs[len(qs) // 3], qs[2 * len(qs) // 3]]
            print("  by distance (eye spacing as share of frame; bigger = closer):")
            for label, lo, hi in [("far", 0, cut[0]), ("mid", cut[0], cut[1]), ("near", cut[1], 9)]:
                g = [e for e in dog if lo <= e.get("prox", 0) < hi]
                j = [abs(b["raw"][0] - a["raw"][0]) for a, b in zip(g, g[1:]) if a.get("raw") and b.get("raw")]
                print(f"    {label:5s} spacing {lo:.3f}-{min(hi, max(prox)):.3f}  nose conf {mean([e['kpts'][0][2] for e in g]):.2f}  eyes conf {mean([min(e['kpts'][1][2], e['kpts'][2][2]) for e in g]):.2f}  raw shake {pct(st.median(j)) if j else '  —  '}")

    # ground truth, when this is a pointer-test clip
    targets = [m for m in marks if m.get("kind") == "target" and m.get("phase") == "measure"]
    if targets:
        print(f"  pointer test ({next((m.get('distance') for m in marks if m.get('kind') == 'pointer-test-start'), '?')}):")
        print("    target      found   err x / y     shake x / y   raw shake x   nose-only err x   nose conf")
        for i, m in enumerate(targets):
            end = targets[i + 1]["t"] - 1500 if i + 1 < len(targets) else m["t"] + 3500
            win = [e for e in poses if m["t"] <= e["t"] <= end]
            hit = [e for e in win if e.get("ptr")]
            if not win: continue
            xs, ys = [e["ptr"][0] for e in hit], [e["ptr"][1] for e in hit]
            raw = [e["raw"][0] for e in win if e.get("raw")]
            # what the pointer would have been without the head-turn term
            nose_only = [e["raw"][0] - .5 * max(-.6, min(.6, e["yaw"] - e["neutral"])) if e.get("yawUsed") else e["raw"][0] for e in win if e.get("raw")]
            print(f"    {m['x']:.2f},{m['y']:.2f}   {len(hit) / len(win):5.0%}   " + (f"{pct(mean(xs) - m['x'])} /{pct(mean(ys) - m['y'])}   {pct(sd(xs))} /{pct(sd(ys))}   {pct(sd(raw))}         {pct(mean(nose_only) - m['x'])}           " if hit else " " * 58) + f"{mean([e['kpts'][0][2] for e in win if e.get('kpts')]):.2f}")

if __name__ == "__main__":
    args = sys.argv[1:] or sorted(str(p) for p in (Path(__file__).parent / "inbox").glob("*.zip"))
    if not args: sys.exit("nothing to analyse: pass clip .json/.zip paths or drop zips in ml/inbox/")
    for name, meta in load(args): report(name, meta)
