#!/usr/bin/env python3
"""Session replay: what the camera saw next to what was on the screen, with what the model did drawn over both.

    ml/.venv/bin/python ml/replay.py                       # every zip in ml/inbox/ -> ml/out/replay/*.mp4
    ml/.venv/bin/python ml/replay.py clip.zip other.zip

Left: the camera, mirrored (so left/right match the screen), with the recorded box, head keypoints and confidence.
Right: the screen, rebuilt from the timeline's screen reference. Games are re-drawn exactly (target, pointer,
touches). Videos are shown as their poster frame with the content id and playback time, because for now the
timeline holds a *reference* to what was on screen, not its pixels; `kind: "capture"` is reserved for when it does.
Bottom: attention over the clip with a playhead, plus presence, arousal and screen state. Sound is kept.

The recorded model output is a cache. To see what a *different* model would have done on the same footage, run
ml/eval_clips.py on the extracted video.
"""
import glob, json, os, subprocess, sys, tempfile, zipfile
from pathlib import Path
import cv2, numpy as np

ROOT = Path(__file__).parent
OUT = ROOT / "out" / "replay"; OUT.mkdir(parents=True, exist_ok=True)
FPS, W, H, STRIP = 15, 640, 480, 110
YELLOW, BLUE, WHITE, GREY = (63, 210, 255), (255, 134, 58), (255, 255, 255), (150, 150, 150)
NAMES = ["N", "LE", "RE", "LB", "RB", "LT", "RT", "C"]
posters = {}

def poster(ref):
    if ref not in posters:
        img = None
        try:
            data = subprocess.run(["curl", "-sfL", "--max-time", "8", f"https://i.ytimg.com/vi/{ref}/hqdefault.jpg"], capture_output=True, check=True).stdout   # curl: the venv's Python often lacks CA certs on macOS
            img = cv2.resize(cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR), (W, H))
        except Exception:
            pass
        posters[ref] = img
    return posters[ref]

def mmss(t): return "--:--" if t is None else f"{int(t // 60):02d}:{int(t % 60):02d}"

def draw_camera(fr, e):
    if e.get("kpts"):
        b = e["box"]; cv2.rectangle(fr, (int(b[0] * W), int(b[1] * H)), (int((b[0] + b[2]) * W), int((b[1] + b[3]) * H)), BLUE, 2)
        for i, k in enumerate(e["kpts"][:8]):
            if k[2] < .35: continue
            col = YELLOW if i == 0 else WHITE if i in (1, 2) else BLUE
            cv2.circle(fr, (int(k[0] * W), int(k[1] * H)), 6 if i == 0 else 4, col, -1)
    fr = cv2.flip(fr, 1)
    if e.get("kpts"):   # labels after the flip so they read the right way round
        for i, k in enumerate(e["kpts"][:8]):
            if k[2] >= .35: cv2.putText(fr, NAMES[i], (int((1 - k[0]) * W) + 7, int(k[1] * H) - 6), 0, .45, WHITE, 1)
        cv2.putText(fr, f"dog {e.get('score', 0):.2f}  nose {e['kpts'][0][2]:.2f}  ref {e.get('ref')}", (8, H - 10), 0, .5, WHITE, 1)
    else:
        cv2.putText(fr, "no dog", (8, H - 10), 0, .5, GREY, 1)
    return fr

def draw_screen(e, touches, t):
    s = e.get("screen") or {"kind": e.get("mode", "none")}
    kind = s.get("kind")
    pane = np.zeros((H, W, 3), np.uint8)
    if kind in ("youtube", "file"):
        img = poster(s["ref"]) if kind == "youtube" else None
        if img is not None: pane = (img * .45).astype(np.uint8)
        cv2.putText(pane, f"{s['id']}", (12, 28), 0, .6, WHITE, 1)
        cv2.putText(pane, f"{kind}  {mmss(s.get('t'))} / {mmss(s.get('dur'))}  {s.get('state')}", (12, 54), 0, .6, YELLOW if s.get("state") == "playing" else GREY, 1)
        cv2.putText(pane, "poster frame: the timeline holds a reference, not the pixels", (12, H - 12), 0, .42, GREY, 1)
    elif kind == "game":
        x, y, r = s["target"]; rad = int(r * min(W, H))
        cv2.circle(pane, (int(x * W), int(y * H)), rad, YELLOW, -1)
        cv2.putText(pane, f"{s['id']}  hits {s.get('hits', 0)}", (12, 28), 0, .6, WHITE, 1)
    elif kind == "capture":
        cv2.putText(pane, "screen capture (not implemented in replay yet)", (12, 28), 0, .6, WHITE, 1)
    else:
        cv2.putText(pane, str(kind), (12, 28), 0, .6, GREY, 1)
    if e.get("raw"): cv2.circle(pane, (int(e["raw"][0] * W), int(e["raw"][1] * H)), 5, GREY, 1)          # pointer before smoothing
    if e.get("ptr"): cv2.circle(pane, (int(e["ptr"][0] * W), int(e["ptr"][1] * H)), 14, BLUE, 3)        # pointer as shown
    for tt in touches:
        age = t - tt["t"]
        if 0 <= age < 800: cv2.circle(pane, (int(tt["x"] * W), int(tt["y"] * H)), int(10 + age / 12), WHITE, 2)
    return pane

def render(video, meta, out):
    tl = meta["timeline"]
    poses = [e for e in tl if e.get("type") == "pose"]
    touches = [e for e in tl if e.get("type") == "touch"]
    if not poses: print("  no pose entries, skipped"); return
    work = tempfile.mkdtemp(prefix="dogos-replay-")
    cfr = os.path.join(work, "cfr.mp4")   # MediaRecorder WebM has no seek index and uneven frame timing: make it constant-rate first
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-vf", f"fps={FPS},scale={W}:{H}", "-an", cfr], check=True)
    cap = cv2.VideoCapture(cfr)
    silent = os.path.join(work, "silent.mp4")
    vw = cv2.VideoWriter(silent, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W * 2, H + STRIP))
    dur = max(poses[-1]["t"], 1)
    trace = np.zeros((STRIP, W * 2, 3), np.uint8)
    pts = [(int(e["t"] / dur * (W * 2 - 1)), int(STRIP - 28 - e.get("att", 0) * (STRIP - 40))) for e in poses]
    cv2.line(trace, (0, int(STRIP - 28 - .45 * (STRIP - 40))), (W * 2, int(STRIP - 28 - .45 * (STRIP - 40))), (60, 60, 60), 1)
    for a, b in zip(pts, pts[1:]): cv2.line(trace, a, b, YELLOW, 2)
    i = j = 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        t = i * 1000 / FPS; i += 1
        while j + 1 < len(poses) and poses[j + 1]["t"] <= t: j += 1
        e = poses[j] if abs(poses[j]["t"] - t) < 600 else {"mode": "none"}
        strip = trace.copy()
        x = int(t / dur * (W * 2 - 1)); cv2.line(strip, (x, 0), (x, STRIP - 24), WHITE, 1)
        cv2.putText(strip, f"{t / 1000:6.1f}s  attention {e.get('att', 0):.2f}  {e.get('arousal', '')}  mode {e.get('mode', '')}  yaw {e.get('yaw', 0):+.2f}  {e.get('inferMs', 0)} ms", (8, STRIP - 7), 0, .5, WHITE, 1)
        vw.write(np.vstack([np.hstack([draw_camera(fr, e), draw_screen(e, touches, t)]), strip]))
    vw.release(); cap.release()
    has_audio = "audio" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", video], capture_output=True, text=True).stdout
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", silent] + (["-i", video, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-shortest"] if has_audio else []) + ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", str(out)]
    subprocess.run(cmd, check=True)
    print(f"  -> {out}  ({i} frames, sound {'kept' if has_audio else 'none'})")

if __name__ == "__main__":
    work = tempfile.mkdtemp(prefix="dogos-clips-")
    for z in sys.argv[1:] or sorted(glob.glob(str(ROOT / "inbox" / "*.zip"))):
        zipfile.ZipFile(z).extractall(work)
    metas = sorted(glob.glob(os.path.join(work, "*.json")))
    if not metas: sys.exit("nothing to replay: pass clip zips or drop them in ml/inbox/")
    for m in metas:
        stem = Path(m).stem
        video = next((v for v in (os.path.join(work, stem + ext) for ext in (".webm", ".mp4")) if os.path.exists(v)), None)
        if not video: continue
        print(stem); render(video, json.load(open(m)), OUT / f"{stem}.mp4")
