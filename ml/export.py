"""Export the trained pose model for the web app and measure what was exported.

  ml/.venv/bin/python ml/export.py [--weights ml/runs/dogpose/weights/best.pt] [--opset 17] [--max-det 20]

Writes public/models/dogpose.onnx (fp32, 320 px, batch 1, simplified), public/models/dogpose.json (the decoder
contract, written from the real ONNX graph), optionally public/models/dogpose.int8.onnx, and ml/out/export_metrics.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

from common import (DATASETS, HEAD_DS, HEAD_KPTS, FLIP_IDX, IMGSZ, LEYE, META_PATH, ML, MODELS, NOSE, ONNX_PATH, OUT, REYE, RUNS,
                    DogPose, die, letterbox, ultralytics_settings)

NEVER_SUPERVISED = ["throat", "withers"]      # no source annotates them yet (Dog-Pose columns are empty)


def newest_best() -> Path:
    c = [p for p in RUNS.glob("*/weights/best.pt") if "_timing" not in str(p)] or list(RUNS.glob("*/weights/best.pt"))
    if not c:
        die("no trained weights under ml/runs/*/weights/best.pt; run ml/train_pose.py first or pass --weights")
    return max(c, key=lambda p: p.stat().st_mtime)


def val_items(limit: int | None = None, dogs_only: bool = False):
    """[(image path, label path)] from the dog-head val split (includes the no-dog background images)."""
    items = []
    for p in sorted((HEAD_DS / "images/val").glob("*")):
        lab = HEAD_DS / "labels/val" / f"{p.stem}.txt"
        if not lab.exists() or (dogs_only and not lab.read_text().strip()):
            continue
        items.append((p, lab))
    if limit:
        step = max(1, len(items) // limit)
        items = items[::step][:limit]
    return items


def read_gt(lab: Path, w: int, h: int):
    out = []
    for line in lab.read_text().splitlines():
        f = np.array(line.split(), dtype=np.float32)
        cx, cy, bw, bh = f[1:5] * [w, h, w, h]
        k = f[5:].reshape(-1, 3).copy()
        k[:, 0] *= w
        k[:, 1] *= h
        out.append((np.array([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]), k))
    return out


def iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def keypoint_error(model: DogPose, items, conf: float):
    """Per-keypoint error in 320-px letterboxed input pixels, on annotated GT keypoints of matched dogs."""
    errs = {k: [] for k in HEAD_KPTS}
    confs = {k: [] for k in HEAD_KPTS}
    n_gt = n_hit = n_bg = n_bg_fp = 0
    ms = []
    for p, lab in items:
        img = cv2.imread(str(p))
        h, w = img.shape[:2]
        canvas, r, px, py = letterbox(img, model.size)
        t0 = time.perf_counter()
        out = model.raw(canvas)
        ms.append((time.perf_counter() - t0) * 1000)
        dets = model.decode(out, conf)
        gts = read_gt(lab, w, h)
        if not gts:                                   # background image: any detection is a false positive
            n_bg += 1
            n_bg_fp += bool(dets)
        for box, k in gts:
            n_gt += 1
            gbox = box * r + [px, py, px, py]
            best = max(dets, key=lambda d: iou(d["box"], gbox), default=None)
            if best is None or iou(best["box"], gbox) < 0.5:
                continue
            n_hit += 1
            for i, name in enumerate(HEAD_KPTS):
                if k[i, 2] > 0:
                    gx, gy = k[i, 0] * r + px, k[i, 1] * r + py
                    errs[name].append(float(np.hypot(best["kpts"][i, 0] - gx, best["kpts"][i, 1] - gy)))
                    confs[name].append(float(best["kpts"][i, 2]))
    per = {}
    for name in HEAD_KPTS:
        e = np.array(errs[name])
        per[name] = None if not len(e) else dict(n=int(len(e)), mean_px=round(float(e.mean()), 2),
                                                 median_px=round(float(np.median(e)), 2),
                                                 p90_px=round(float(np.percentile(e, 90)), 2),
                                                 mean_conf=round(float(np.mean(confs[name])), 3))
    ms = np.array(ms[5:] or ms)
    return dict(gt_dogs=n_gt, matched_iou50=n_hit, detection_rate=round(n_hit / max(1, n_gt), 4),
                no_dog_images=n_bg, no_dog_false_positive_rate=round(n_bg_fp / max(1, n_bg), 4), per_keypoint=per,
                ort_cpu_ms_mean=round(float(ms.mean()), 2), ort_cpu_ms_median=round(float(np.median(ms)), 2))


def bench(onnx_path: Path, threads: int, n: int = 100) -> float:
    """Median ms per frame, onnxruntime CPU EP on this Mac (pure inference, no pre/post-processing)."""
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    sess = ort.InferenceSession(str(onnx_path), so, providers=["CPUExecutionProvider"])
    x = np.random.rand(1, 3, IMGSZ, IMGSZ).astype(np.float32)
    name = sess.get_inputs()[0].name
    for _ in range(10):
        sess.run(None, {name: x})
    t = []
    for _ in range(n):
        t0 = time.perf_counter()
        sess.run(None, {name: x})
        t.append((time.perf_counter() - t0) * 1000)
    return round(float(np.median(t)), 2)


COCO_ANIMALS = {14, 15, 17, 18, 19, 20, 21, 22, 23, 77}      # bird cat horse sheep cow elephant bear zebra giraffe teddy


def sweep(model: DogPose, items):
    """Image-level 'is there a dog' at several thresholds.

    No-dog images are split into 'another animal / teddy bear in frame' (a nano model trained on one class calls many
    cats and bears a dog) and 'no animal' (rooms, people, streets). The recommended threshold is the lowest one with
    <= 1% false alarms on the no-animal group, clamped to 0.25..0.6.
    """
    pos, neg, neg_animal = [], [], []
    coco = DATASETS / "coco" / "coco-val2017" / "labels" / "val2017"
    for p, lab in items:
        canvas, *_ = letterbox(cv2.imread(str(p)), model.size)
        d = model.decode(model.raw(canvas), 0.01)
        c = d[0]["conf"] if d else 0.0
        if lab.read_text().strip():
            pos.append(c)
            continue
        src = coco / (p.stem[4:] + ".txt")
        cls = {int(l.split()[0]) for l in src.read_text().splitlines() if l.strip()} if src.exists() else set()
        (neg_animal if cls & COCO_ANIMALS else neg).append(c)
    pos, neg, neg_animal = np.array(pos), np.array(neg), np.array(neg_animal)
    rate = lambda v, t: round(float((v >= t).mean()), 4) if len(v) else None
    table = [dict(conf=round(float(t), 2), dog_images_detected=rate(pos, t), false_alarm_no_animal=rate(neg, t),
                  false_alarm_other_animal=rate(neg_animal, t)) for t in np.arange(0.15, 0.80, 0.05)]
    ok = [r["conf"] for r in table if r["false_alarm_no_animal"] is not None and r["false_alarm_no_animal"] <= 0.01]
    pick = min(max(ok[0] if ok else 0.5, 0.25), 0.6)
    return dict(n_dog_images=len(pos), n_no_animal=len(neg), n_other_animal=len(neg_animal), table=table), float(pick)


def parity(weights: Path, model: DogPose, items):
    """PyTorch vs onnxruntime on the same letterboxed 320x320 input: top detection, keypoints in px."""
    from ultralytics import YOLO
    pt = YOLO(str(weights))
    rows = []
    for p, _ in items:
        canvas, *_ = letterbox(cv2.imread(str(p)), model.size)
        o = model.decode(model.raw(canvas), 0.05)
        # nms=False selects the NMS-free one-to-one head, the same head the ONNX graph contains
        r = pt.predict(canvas, imgsz=model.size, conf=0.05, device="cpu", verbose=False,
                       **({"nms": False} if model.end2end else {}))[0]
        if not o or r.keypoints is None or not len(r.boxes):
            rows.append(dict(image=p.name, note="no detection in one of the two"))
            continue
        kp = r.keypoints.data[0].cpu().numpy()
        bx = r.boxes.xyxy[0].cpu().numpy()
        rows.append(dict(image=p.name,
                         max_kpt_diff_px=round(float(np.abs(kp[:, :2] - o[0]["kpts"][:, :2]).max()), 4),
                         max_kpt_conf_diff=round(float(np.abs(kp[:, 2] - o[0]["kpts"][:, 2]).max()), 4),
                         max_box_diff_px=round(float(np.abs(bx - o[0]["box"]).max()), 4),
                         conf_diff=round(abs(float(r.boxes.conf[0]) - o[0]["conf"]), 5)))
    return rows


def write_meta(onnx_path: Path, conf: float, base: str, max_det: int):
    import onnx
    import onnxruntime as ort
    m = onnx.load(str(onnx_path))
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    i, outs = sess.get_inputs()[0], sess.get_outputs()
    o = outs[0]
    K = len(HEAD_KPTS)
    shape = list(o.shape)
    end2end = len(shape) == 3 and shape[2] == 6 + K * 3
    raw = len(shape) == 3 and shape[1] == 4 + 1 + K * 3
    if not (end2end or raw):
        die(f"unexpected ONNX output shape {shape}; update write_meta() and the JS decoder")
    y = sess.run(None, {i.name: np.random.rand(*i.shape).astype(np.float32)})[0]
    assert list(y.shape) == shape, (y.shape, shape)
    meta = {
        "model": "dogpose.onnx",
        "baseModel": base,
        "opset": int(m.opset_import[0].version),
        "ops": sorted({n.op_type for n in m.graph.node}),
        "input": {
            "name": i.name, "shape": list(i.shape), "dtype": "float32", "layout": "NCHW", "channelOrder": "RGB",
            "scaling": "pixel / 255 (range 0..1), no mean/std normalization",
            "letterbox": {
                "size": IMGSZ, "padValue": 114, "center": True,
                "how": "r = min(320/w, 320/h); resize to (round(w*r), round(h*r)); paste at padX = floor((320-newW)/2), "
                       "padY = floor((320-newH)/2) on a 320x320 canvas filled with RGB(114,114,114). "
                       "Undo on outputs: x = (x320 - padX) / r, y = (y320 - padY) / r.",
            },
        },
        "output": {
            "name": o.name, "shape": shape, "dtype": "float32",
            "end2end": end2end, "needsNMS": not end2end,
            "coordinates": "pixels of the 320x320 letterboxed input (not normalized)",
        },
        "numClasses": 1, "classNames": ["dog"],
        "keypoints": HEAD_KPTS, "flipIdx": FLIP_IDX,
        "keypointsNeverSupervised": NEVER_SUPERVISED,
        "keypointNotes": {
            "left/right": "the DOG's left/right. For a dog facing the camera, left_eye is on the image's right side "
                          "(before any mirroring of the front-camera preview).",
            "eyes": "supervised only by AP-10K canids (~1k images); ears/chin only by Dog-Pose; nose by both.",
            "throat,withers": "never annotated in any training source: ignore x,y and confidence for these two.",
        },
        "recommendedConfThreshold": conf,
        "recommendedKeypointConfThreshold": 0.5,
    }
    if end2end:
        meta["output"].update({
            "layout": "rows",
            "rowLayout": ["x1", "y1", "x2", "y2", "conf", "cls"] + [f"{k}_{c}" for k in HEAD_KPTS for c in ("x", "y", "conf")],
            "rows": shape[1], "rowLength": shape[2],
            "boxFormat": "xyxy corners",
            "description": f"NMS-free (YOLO26 one-to-one head, top-{shape[1]} already applied inside the graph). "
                           f"output[0][i] is one candidate, sorted by conf descending; rows with conf below the threshold are "
                           "filler. Take row 0 if conf >= recommendedConfThreshold. cls is always 0. "
                           "Keypoint conf is already sigmoid-ed (0..1).",
        })
    else:
        meta["output"].update({
            "layout": "channels_first_anchors_last",
            "channelLayout": ["cx", "cy", "w", "h", "conf_dog"] + [f"{k}_{c}" for k in HEAD_KPTS for c in ("x", "y", "conf")],
            "channels": shape[1], "anchors": shape[2],
            "boxFormat": "xywh, x/y are the box CENTER",
            "description": "Raw head: output[0][c][a]. Needs confidence filtering + NMS (IoU 0.5) in JS. "
                           "Scores and keypoint conf are already sigmoid-ed (0..1).",
        })
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n")
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--max-det", type=int, default=20, help="rows kept by the in-graph top-k of the NMS-free head")
    ap.add_argument("--conf", type=float, default=0.0, help="detection threshold for dogpose.json (0 = choose from a sweep on val)")
    ap.add_argument("--val-limit", type=int, default=0, help="evaluate on a subset of val (0 = all)")
    ap.add_argument("--skip-int8", action="store_true")
    a = ap.parse_args()

    ultralytics_settings()
    weights = Path(a.weights) if a.weights else newest_best()
    if not weights.exists():
        die(f"{weights} not found")
    print("exporting", weights)
    from ultralytics import YOLO
    model = YOLO(str(weights))
    info_p = weights.parent.parent / "train_info.json"
    base = json.loads(info_p.read_text())["base"] if info_p.exists() else "unknown"
    f = model.export(format="onnx", imgsz=IMGSZ, simplify=True, dynamic=False, batch=1, half=False, opset=a.opset,
                     nms=False, max_det=a.max_det, device="cpu")
    MODELS.mkdir(parents=True, exist_ok=True)
    shutil.move(str(f), ONNX_PATH)
    meta = write_meta(ONNX_PATH, a.conf or 0.35, base, a.max_det)
    print("wrote", ONNX_PATH, f"{ONNX_PATH.stat().st_size / 1e6:.2f} MB;", "end2end" if meta["output"]["end2end"] else "raw+NMS",
          meta["output"]["shape"], "opset", meta["opset"])

    items = val_items(a.val_limit or None)
    fp32 = DogPose(ONNX_PATH)
    table, picked = sweep(fp32, items)
    if not a.conf:
        a.conf = picked
        meta = write_meta(ONNX_PATH, a.conf, base, a.max_det)
    res = {"recommended_conf": a.conf, "threshold_sweep_fp32": table,"weights": str(weights), "onnx_mb": round(ONNX_PATH.stat().st_size / 1e6, 3), "opset": meta["opset"],
           "end2end": meta["output"]["end2end"], "output_shape": meta["output"]["shape"],
           "parity_pytorch_vs_ort": parity(weights, fp32, val_items(10, dogs_only=True)),
           "fp32": keypoint_error(fp32, items, a.conf)}
    res["fp32"]["bench_ms_median"] = {"1_thread": bench(ONNX_PATH, 1), "4_threads": bench(ONNX_PATH, 4)}

    int8_path = MODELS / "dogpose.int8.onnx"
    if not a.skip_int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        from onnxruntime.quantization.shape_inference import quant_pre_process
        pre = OUT / "dogpose.pre.onnx"
        OUT.mkdir(exist_ok=True)
        try:
            quant_pre_process(str(ONNX_PATH), str(pre))
        except Exception as e:                           # pre-processing is optional
            print("quant_pre_process failed, quantizing the plain graph:", e)
            shutil.copy2(ONNX_PATH, pre)
        quantize_dynamic(str(pre), str(int8_path), weight_type=QuantType.QUInt8)
        pre.unlink(missing_ok=True)
        try:
            q = keypoint_error(DogPose(int8_path), items, a.conf)
            q["onnx_mb"] = round(int8_path.stat().st_size / 1e6, 3)
            q["bench_ms_median"] = {"1_thread": bench(int8_path, 1), "4_threads": bench(int8_path, 4)}
            res["int8"] = q

            def e(r, k):
                return (r["per_keypoint"][k] or {}).get("mean_px", float("inf"))
            ok = (q["detection_rate"] >= res["fp32"]["detection_rate"] - 0.01 and
                  all(e(q, k) <= e(res["fp32"], k) * 1.10 + 0.25 for k in (HEAD_KPTS[NOSE], HEAD_KPTS[LEYE], HEAD_KPTS[REYE])))
            res["int8_kept"] = bool(ok)
        except Exception as ex:
            res["int8"] = {"error": f"{type(ex).__name__}: {ex}"}
            res["int8_kept"] = False
        if not res["int8_kept"]:
            int8_path.unlink(missing_ok=True)
            print("int8 rejected (accuracy or runtime), deleted")
    meta["files"] = {"fp32": {"file": "dogpose.onnx", "mb": res["onnx_mb"]}}
    if res.get("int8_kept"):
        meta["files"]["int8"] = {"file": "dogpose.int8.onnx", "mb": res["int8"]["onnx_mb"],
                                 "note": "onnxruntime dynamic int8 (ConvInteger/MatMulInteger/DynamicQuantizeLinear). Same input, "
                                         "output and decoder. Accuracy on val matches fp32. Loads and runs in onnxruntime-web 1.22 WASM "
                                         "(checked in Node: same speed as fp32, so the only gain is download size). Not for the WebGPU EP. "
                                         "Default to fp32."}
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n")
    OUT.mkdir(exist_ok=True)
    (OUT / "export_metrics.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
