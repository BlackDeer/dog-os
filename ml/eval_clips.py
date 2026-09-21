"""Run the exported model over a video, write an overlay mp4 to ml/out/ and print the honest numbers.

  ml/.venv/bin/python ml/eval_clips.py <video> [--model public/models/dogpose.onnx] [--conf 0.35] [--fps 10]

Uses the same ONNX file + letterbox + decoder the web app uses (common.DogPose), so what you see is what the phone gets.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from common import HEAD_KPTS, LEYE, NOSE, ONNX_PATH, OUT, REYE, DogPose, die

COLORS = [(0, 220, 255), (255, 160, 0), (255, 160, 0), (80, 220, 80), (80, 220, 80),
          (60, 160, 60), (60, 160, 60), (200, 80, 255), (150, 150, 150), (150, 150, 150)]
EDGES = [(1, 2), (0, 1), (0, 2), (3, 5), (4, 6), (0, 7), (1, 3), (2, 4)]


def draw(frame, det, kconf: float):
    x1, y1, x2, y2 = [int(v) for v in det["box"]]
    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 200, 0), 2)
    cv2.putText(frame, f"dog {det['conf']:.2f}", (x1 + 3, max(14, y1 - 5)), 0, 0.5, (255, 200, 0), 1, cv2.LINE_AA)
    k = det["kpts"]
    for a, b in EDGES:
        if k[a, 2] >= kconf and k[b, 2] >= kconf:
            cv2.line(frame, (int(k[a, 0]), int(k[a, 1])), (int(k[b, 0]), int(k[b, 1])), (255, 255, 255), 1, cv2.LINE_AA)
    for i, (x, y, c) in enumerate(k):
        if i >= 8:                     # throat / withers are not supervised yet
            continue
        p = (int(x), int(y))
        if c >= kconf:
            cv2.circle(frame, p, 6 if i == NOSE else 4, COLORS[i], -1, cv2.LINE_AA)
        else:
            cv2.circle(frame, p, 4, COLORS[i], 1, cv2.LINE_AA)
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--model", default=str(ONNX_PATH))
    ap.add_argument("--conf", type=float, default=None, help="detection threshold (default: from dogpose.json)")
    ap.add_argument("--kconf", type=float, default=0.5, help="keypoint confidence counted as 'found'")
    ap.add_argument("--fps", type=float, default=10.0, help="evaluation frame rate (the app never runs faster than 10)")
    a = ap.parse_args()
    src = Path(a.video)
    if not src.exists():
        die(f"{src} not found")
    model = DogPose(a.model)
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        die(f"cannot open {src} (is it a video ffmpeg/OpenCV can read?)")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0
    if not (1 <= src_fps <= 120):      # MediaRecorder WebM often reports 1000 fps
        src_fps = 15.0
    step = max(1, round(src_fps / a.fps))
    out_fps = src_fps / step
    OUT.mkdir(exist_ok=True)
    tmp = OUT / f"{src.stem}.overlay.tmp.mp4"
    final = OUT / f"{src.stem}.overlay.mp4"
    writer = None
    n = hits = 0
    confs = {NOSE: [], LEYE: [], REYE: []}
    found = {NOSE: 0, LEYE: 0, REYE: 0}
    nose_track, box_diag = [], []
    i = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        i += 1
        if i % step:
            continue
        n += 1
        h, w = frame.shape[:2]
        dets = model.predict(frame, a.conf)
        if dets:
            d = dets[0]
            hits += 1
            for k in confs:
                confs[k].append(float(d["kpts"][k, 2]))
                found[k] += d["kpts"][k, 2] >= a.kconf
            scale = 320 / max(w, h)   # report jitter in 320-px model pixels
            nose_track.append((d["kpts"][NOSE, :2] * scale) if d["kpts"][NOSE, 2] >= a.kconf else None)
            box_diag.append(float(np.hypot(d["box"][2] - d["box"][0], d["box"][3] - d["box"][1]) * scale))
            draw(frame, d, a.kconf)
        else:
            nose_track.append(None)
        cv2.putText(frame, f"{i / src_fps:6.2f}s  {'DOG' if dets else 'no dog'}", (8, h - 10), 0, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        if writer is None:
            writer = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), out_fps, (w, h))
        writer.write(frame)
    cap.release()
    if writer is None:
        die("no frames decoded")
    writer.release()
    if shutil.which("ffmpeg"):       # re-encode to H.264 so QuickTime / browsers play it
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(tmp), "-c:v", "libx264",
                            "-pix_fmt", "yuv420p", "-crf", "23", str(final)], capture_output=True, text=True)
        if r.returncode == 0:
            tmp.unlink()
        else:
            tmp.rename(final)
    else:
        tmp.rename(final)

    steps = [float(np.hypot(*(b - a_))) for a_, b in zip(nose_track, nose_track[1:]) if a_ is not None and b is not None]
    # jitter = high-frequency wobble: second difference removes steady motion of the head
    acc = [float(np.hypot(*(c - 2 * b + a_))) for a_, b, c in zip(nose_track, nose_track[1:], nose_track[2:])
           if a_ is not None and b is not None and c is not None]
    mean = lambda v: round(float(np.mean(v)), 3) if len(v) else None
    summary = {
        "video": str(src), "model": str(a.model), "frames_evaluated": n, "eval_fps": round(out_fps, 2),
        "detection_rate": round(hits / max(1, n), 4),
        "mean_conf": {HEAD_KPTS[k]: mean(v) for k, v in confs.items()},
        "found_rate_given_detection": {HEAD_KPTS[k]: round(found[k] / max(1, hits), 4) for k in found},
        "nose_step_px320_mean": mean(steps),
        "nose_jitter_px320_mean": mean(acc),
        "nose_jitter_px320_median": round(float(np.median(acc)), 3) if acc else None,
        "mean_box_diag_px320": mean(box_diag),
        "overlay": str(final),
    }
    (OUT / f"{src.stem}.summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print("\njitter = mean |p[t+1] - 2p[t] + p[t-1]| of the nose in 320-px model pixels (0 = perfectly smooth).")
    print("These numbers say how STABLE and CONFIDENT the model is, not whether the dot is on the nose: watch the overlay.")


if __name__ == "__main__":
    main()
