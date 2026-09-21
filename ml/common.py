"""Shared paths, keypoint definitions and the ONNX runner used by every ml/ script."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent
REPO = ML.parent

# Keep every Ultralytics side effect (settings, downloads, runs) inside ml/.
os.environ.setdefault("YOLO_CONFIG_DIR", str(ML / ".ultralytics"))
(ML / ".ultralytics").mkdir(exist_ok=True)

DATASETS = ML / "datasets"
SRC_DS = DATASETS / "dog-pose"      # original 24-keypoint dataset
HEAD_DS = DATASETS / "dog-head"     # rewritten 10-keypoint dataset (+ head crops)
OWN_DS = DATASETS / "own"           # build dir for the owner's labeled frames
HEAD_YAML = ML / "dog-head.yaml"
RUNS = ML / "runs"
DATA = ML / "data"
RAW = DATA / "raw"
LABELED = DATA / "labeled"          # images/*.jpg + labels/*.txt
QUEUE = DATA / "queue"              # images/*.jpg + labels/*.txt (predictions) + conf/*.json
INBOX = ML / "inbox"
OUT = ML / "out"
MODELS = REPO / "public" / "models"
ONNX_PATH = MODELS / "dogpose.onnx"
META_PATH = MODELS / "dogpose.json"
IMGSZ = 320

HEAD_KPTS = [
    "nose", "left_eye", "right_eye",
    "left_ear_base", "right_ear_base",
    "left_ear_tip", "right_ear_tip",
    "chin", "throat", "withers",
]
# index of the mirrored keypoint for horizontal flips
FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 7, 8, 9]
NOSE, LEYE, REYE = 0, 1, 2
NK = len(HEAD_KPTS)


def die(msg: str, code: int = 1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def ultralytics_settings():
    """Point Ultralytics' dataset/weights/runs dirs into ml/ (config dir is already ml/.ultralytics)."""
    from ultralytics import settings
    want = {"datasets_dir": str(DATASETS), "weights_dir": str(ML / "weights"),
            "runs_dir": str(RUNS), "sync": False}
    if any(settings.get(k) != v for k, v in want.items()):
        settings.update(want)


# --------------------------------------------------------------------------- inference (ONNX)

def letterbox(img, size: int = IMGSZ, pad_value: int = 114):
    """BGR HxWx3 -> (size x size BGR, scale, pad_x, pad_y). Aspect preserved, centered, grey padding."""
    import cv2
    import numpy as np
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nw, nh = round(w * r), round(h * r)
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas = np.full((size, size, 3), pad_value, dtype=np.uint8)
    canvas[py:py + nh, px:px + nw] = resized
    return canvas, r, px, py


def _iou(a, b):
    import numpy as np
    x1, y1 = np.maximum(a[0], b[:, 0]), np.maximum(a[1], b[:, 1])
    x2, y2 = np.minimum(a[2], b[:, 2]), np.minimum(a[3], b[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]) - inter + 1e-9)


class DogPose:
    """Runs public/models/dogpose.onnx exactly the way the web app does, driven by dogpose.json."""

    def __init__(self, onnx_path: Path | str = ONNX_PATH, meta_path: Path | str | None = None):
        onnx_path = Path(onnx_path)
        meta_path = Path(meta_path) if meta_path else META_PATH
        if not onnx_path.exists():
            die(f"{onnx_path} not found. Train and export first:\n"
                "  ml/.venv/bin/python ml/train_pose.py && ml/.venv/bin/python ml/export.py")
        if not meta_path.exists():
            die(f"{meta_path} not found (written by ml/export.py).")
        import onnxruntime as ort
        self.meta = json.loads(meta_path.read_text())
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        self.sess = ort.InferenceSession(str(onnx_path), so, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.size = int(self.meta["input"]["shape"][-1])
        self.end2end = bool(self.meta["output"]["end2end"])
        self.conf = float(self.meta["recommendedConfThreshold"])

    def raw(self, canvas_bgr):
        import numpy as np
        x = canvas_bgr[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        return self.sess.run(None, {self.inp: np.ascontiguousarray(x)})[0]

    def decode(self, out, conf: float | None = None):
        """-> list of dict(box=[x1,y1,x2,y2], conf, kpts=(K,3)) in 320-px letterboxed input coords."""
        import numpy as np
        conf = self.conf if conf is None else conf
        dets = []
        if self.end2end:                      # [1, N, 6 + K*3] rows: x1,y1,x2,y2,conf,cls,kpts
            rows = out[0]
            rows = rows[rows[:, 4] >= conf]
            for r in rows[np.argsort(-rows[:, 4])]:
                dets.append(dict(box=r[:4].copy(), conf=float(r[4]), kpts=r[6:].reshape(-1, 3).copy()))
        else:                                 # [1, 4 + nc + K*3, A] xywh center, needs NMS
            p = out[0].T
            p = p[p[:, 4] >= conf]
            if len(p):
                b = np.stack([p[:, 0] - p[:, 2] / 2, p[:, 1] - p[:, 3] / 2,
                              p[:, 0] + p[:, 2] / 2, p[:, 1] + p[:, 3] / 2], 1)
                order = np.argsort(-p[:, 4])
                while len(order):
                    i = order[0]
                    dets.append(dict(box=b[i], conf=float(p[i, 4]), kpts=p[i, 5:].reshape(-1, 3).copy()))
                    order = order[1:][_iou(b[i], b[order[1:]]) < 0.5] if len(order) > 1 else order[1:]
        return dets

    def predict(self, img_bgr, conf: float | None = None):
        """Detections mapped back to original image pixels."""
        canvas, r, px, py = letterbox(img_bgr, self.size)
        dets = self.decode(self.raw(canvas), conf)
        for d in dets:
            d["box"] = (d["box"] - [px, py, px, py]) / r
            d["kpts"][:, 0] = (d["kpts"][:, 0] - px) / r
            d["kpts"][:, 1] = (d["kpts"][:, 1] - py) / r
        return dets


def yolo_pose_line(det, w: int, h: int, kpt_conf: float = 0.5) -> str:
    """One YOLO pose label row (class 0, normalized, v=2 when confident else 0)."""
    x1, y1, x2, y2 = [float(v) for v in det["box"]]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    vals = [0, (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, (x2 - x1) / w, (y2 - y1) / h]
    for x, y, c in det["kpts"]:
        ok = c >= kpt_conf and 0 <= x <= w and 0 <= y <= h
        vals += [x / w, y / h, 2] if ok else [0, 0, 0]
    return " ".join(f"{v:.6f}" if isinstance(v, float) else str(v) for v in vals)
