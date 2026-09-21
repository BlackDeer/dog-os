"""Pseudo-label extracted frames with the current model.

  ml/.venv/bin/python ml/prelabel.py [--thr 0.8] [--det-thr 0.5] [--empty-every 5]

For every frame in ml/data/raw/*/*/frames/ that has not been handled yet:
  * dog found and nose + both eyes >= --thr   -> ml/data/labeled/{images,labels}/   (goes straight into training)
  * anything else                             -> ml/data/queue/{images,labels,pred}/ (fix it in the labeler)
  * frames with no detection at all: only every Nth is queued (empty rooms are cheap negatives, not worth your evening)
Frames are copied, never moved; ml/data/prelabel_done.txt remembers what was handled, so re-running is safe.
"""
from __future__ import annotations

import argparse
import json
import shutil

import cv2

from common import DATA, HEAD_KPTS, LABELED, LEYE, NOSE, ONNX_PATH, QUEUE, RAW, REYE, DogPose

UNSUPERVISED = (8, 9)      # throat, withers: the model was never taught these, so never trust its guess


def label_line(det, w, h, kconf):
    x1, y1, x2, y2 = [float(v) for v in det["box"]]
    x1, y1, x2, y2 = max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)
    cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
    vals = [f"{cx:.6f}", f"{cy:.6f}", f"{(x2 - x1) / w:.6f}", f"{(y2 - y1) / h:.6f}"]
    for i, (x, y, c) in enumerate(det["kpts"]):
        if i in UNSUPERVISED:
            vals += [f"{cx:.6f}", f"{cy:.6f}", "3"]            # v=3: not annotated (see partial_labels.py)
        elif c >= kconf and 0 <= x <= w and 0 <= y <= h:
            vals += [f"{x / w:.6f}", f"{y / h:.6f}", "2"]
        else:
            vals += ["0.000000", "0.000000", "0"]
    return "0 " + " ".join(vals) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ONNX_PATH))
    ap.add_argument("--thr", type=float, default=0.8, help="nose AND both eyes must reach this to skip human review")
    ap.add_argument("--det-thr", type=float, default=0.5, help="dog box confidence needed to skip human review")
    ap.add_argument("--kconf", type=float, default=0.5, help="keypoint confidence written as visible")
    ap.add_argument("--empty-every", type=int, default=5)
    a = ap.parse_args()

    frames = sorted(RAW.glob("*/*/frames/*.jpg"))
    if not frames:
        print(f"no frames under {RAW}; run ml/ingest.py first")
        return
    model = DogPose(a.model)
    done_file = DATA / "prelabel_done.txt"
    done = set(done_file.read_text().split()) if done_file.exists() else set()
    for root in (LABELED, QUEUE):
        for sub in ("images", "labels"):
            (root / sub).mkdir(parents=True, exist_ok=True)
    (QUEUE / "pred").mkdir(exist_ok=True)

    n_auto = n_queue = n_empty_skipped = empties = 0
    with done_file.open("a") as log:
        for f in frames:
            if f.name in done:
                continue
            img = cv2.imread(str(f))
            if img is None:
                continue
            h, w = img.shape[:2]
            dets = model.predict(img, 0.15)                     # low threshold: a weak guess still saves dragging
            d = dets[0] if dets else None
            sure = d is not None and d["conf"] >= a.det_thr and all(d["kpts"][k, 2] >= a.thr for k in (NOSE, LEYE, REYE))
            if sure:
                shutil.copy2(f, LABELED / "images" / f.name)
                (LABELED / "labels" / f"{f.stem}.txt").write_text(label_line(d, w, h, a.kconf))
                n_auto += 1
            else:
                if d is None:
                    empties += 1
                    if a.empty_every > 1 and empties % a.empty_every:
                        n_empty_skipped += 1
                        log.write(f.name + "\n")
                        continue
                shutil.copy2(f, QUEUE / "images" / f.name)
                (QUEUE / "labels" / f"{f.stem}.txt").write_text(label_line(d, w, h, a.kconf) if d else "")
                (QUEUE / "pred" / f"{f.stem}.json").write_text(json.dumps({
                    "det_conf": None if d is None else round(d["conf"], 4),
                    "box": None if d is None else [round(float(v), 1) for v in d["box"]],
                    "kpts": None if d is None else [[round(float(x), 1), round(float(y), 1), round(float(c), 4)] for x, y, c in d["kpts"]],
                    "names": HEAD_KPTS, "w": w, "h": h}))
                n_queue += 1
            log.write(f.name + "\n")
    print(f"auto-labeled (confident): {n_auto} -> {LABELED}")
    print(f"queued for review:        {n_queue} -> {QUEUE}")
    print(f"empty frames not queued:  {n_empty_skipped}")
    if n_auto:
        print("note: confident pseudo-labels only teach the model what it already believes. "
              "Spot-check some in the labeler (python ml/labeler/serve.py --review) before retraining.")


if __name__ == "__main__":
    main()
