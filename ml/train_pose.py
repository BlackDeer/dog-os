"""Fine-tune a YOLO nano pose model on the 10 dog-head keypoints.

  ml/.venv/bin/python ml/train_pose.py --budget-min 90      # time one epoch, then fit epochs into the budget
  ml/.venv/bin/python ml/train_pose.py --epochs 40          # fixed epoch count
  ml/.venv/bin/python ml/train_pose.py --epochs 30 --weights ml/runs/dogpose/weights/best.pt   # retrain with own frames

Own frames in ml/data/labeled/{images,labels}/ are mixed in automatically and oversampled (--own-repeat).
About 20% of own clips are held out and reported separately after training.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import yaml  # noqa: E402

from common import FLIP_IDX, HEAD_DS, HEAD_KPTS, HEAD_YAML, LABELED, ML, OWN_DS, RUNS, die, ultralytics_settings  # noqa: E402

IMG_EXT = {".jpg", ".jpeg", ".png"}


def pick_base() -> str:
    """yolo26n-pose if this ultralytics ships it, else yolo11n-pose."""
    import ultralytics
    has26 = (Path(ultralytics.__file__).parent / "cfg/models/26/yolo26-pose.yaml").exists()
    return "yolo26n-pose.pt" if has26 else "yolo11n-pose.pt"


def clip_of(stem: str) -> str:
    """Frames are named <dog>__<clip>__<frame>; hold out whole clips so val frames are not near-copies of train."""
    parts = stem.split("__")
    return "__".join(parts[:2]) if len(parts) >= 3 else stem


def build_own(repeat: int) -> tuple[int, int]:
    """ml/data/labeled -> ml/datasets/own/{images,labels}/{train,val}; train is hardlinked `repeat` times."""
    if OWN_DS.exists():
        shutil.rmtree(OWN_DS)
    imgs = sorted(p for p in (LABELED / "images").glob("*") if p.suffix.lower() in IMG_EXT) if (LABELED / "images").exists() else []
    imgs = [p for p in imgs if (LABELED / "labels" / f"{p.stem}.txt").exists()]
    if not imgs:
        return 0, 0
    clips = sorted({clip_of(p.stem) for p in imgs})
    key = (lambda p: clip_of(p.stem)) if len(clips) >= 5 else (lambda p: p.stem)   # too few clips: split by frame
    n_tr = n_va = 0
    for p in imgs:
        held = int(hashlib.md5(key(p).encode()).hexdigest(), 16) % 5 == 0
        split = "val" if held else "train"
        for sub in ("images", "labels"):
            (OWN_DS / sub / split).mkdir(parents=True, exist_ok=True)
        lab = LABELED / "labels" / f"{p.stem}.txt"
        for r in range(1 if held else repeat):
            suffix = "" if r == 0 else f"_r{r}"
            dst = OWN_DS / "images" / split / f"{p.stem}{suffix}{p.suffix}"
            try:
                os.link(p, dst)
            except OSError:
                shutil.copy2(p, dst)
            text = lab.read_text()
            if held:                               # v=3 ("not annotated") is a train-only convention; the validator needs 0
                rows = []
                for line in text.splitlines():
                    f = line.split()
                    for i in range(7, len(f), 3):
                        if f[i] == "3":
                            f[i - 2], f[i - 1], f[i] = "0.000000", "0.000000", "0"
                    rows.append(" ".join(f))
                text = "\n".join(rows) + ("\n" if rows else "")
            (OWN_DS / "labels" / split / f"{p.stem}{suffix}.txt").write_text(text)
        n_tr, n_va = n_tr + (not held), n_va + held
    return n_tr, n_va


def write_yaml(path: Path, train: list[str], val: list[str]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump({
        "path": str(ML / "datasets"), "train": train, "val": val,
        "kpt_shape": [len(HEAD_KPTS), 3], "flip_idx": FLIP_IDX,
        "names": {0: "dog"}, "kpt_names": {0: HEAD_KPTS},
    }, sort_keys=False))
    return path


def train(weights: str, data: Path, epochs: int, device: str, name: str, a) -> Path:
    from ultralytics import YOLO
    model = YOLO(weights)
    model.train(
        data=str(data), epochs=epochs, imgsz=a.imgsz, batch=a.batch, device=device, workers=a.workers,
        project=str(RUNS), name=name, exist_ok=True, patience=30, plots=False, amp=(device != "mps"),
        cos_lr=True, close_mosaic=max(1, min(10, epochs // 5)),
        # the phone sees a dim, noisy, slightly blurred, wide-angle face: push photometric + scale augmentation.
        # (blur / sensor noise / JPEG damage are baked into the head-crop copies by prepare_dataset.py)
        hsv_h=0.02, hsv_s=0.6, hsv_v=0.6, degrees=20, translate=0.15, scale=0.6, shear=2.0,
        perspective=0.0005, fliplr=0.5, mosaic=0.5, mixup=0.0, erasing=0.0,
    )
    return RUNS / name / "weights" / "best.pt"


def evaluate(best: Path, data: Path, n_va: int, device: str, a) -> dict:
    """mAP for both heads: nms=False is the NMS-free one-to-one head that export.py ships, nms=None is one-to-many + NMS."""
    from ultralytics import YOLO
    out = {}

    def one(tag, yaml_path, **kw):
        r = YOLO(str(best)).val(data=str(yaml_path), imgsz=a.imgsz, batch=32, device=device, plots=False, project=str(RUNS),
                                name=f"{a.name}_{tag}", exist_ok=True, **kw)
        return {"pose_mAP50": round(float(r.pose.map50), 4), "pose_mAP50_95": round(float(r.pose.map), 4),
                "box_mAP50": round(float(r.box.map50), 4), "box_mAP50_95": round(float(r.box.map), 4)}

    out["val_nmsfree_head"] = one("val_e2e", data, nms=False)
    out["val_nms_head"] = one("val_nms", data)
    if n_va:
        own = write_yaml(RUNS / "_own.yaml", [str(OWN_DS / "images/val")], [str(OWN_DS / "images/val")])
        out["val_own_heldout"] = {"frames": n_va, **one("val_own", own, nms=False)}
    else:
        out["val_own_heldout"] = None
        print("no own labeled frames yet: real-world accuracy is UNKNOWN (see ml/README.md)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=0, help="fixed epoch count (skips timing)")
    ap.add_argument("--budget-min", type=float, default=90, help="wall-clock budget when --epochs is not given")
    ap.add_argument("--max-epochs", type=int, default=100)
    ap.add_argument("--weights", default="", help="start from these weights instead of the pretrained base")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--own-repeat", type=int, default=8, help="oversampling factor for ml/data/labeled")
    ap.add_argument("--name", default="dogpose")
    ap.add_argument("--val-only", action="store_true", help="skip training, score ml/runs/<name>/weights/best.pt")
    a = ap.parse_args()

    if not HEAD_YAML.exists() or not (HEAD_DS / "images/train").exists():
        die("dataset missing: run  ml/.venv/bin/python ml/prepare_dataset.py  first")
    ultralytics_settings()
    import partial_labels
    partial_labels.patch()
    os.chdir(ML)                                   # pretrained weights download next to the scripts (*.pt is ignored)

    n_tr, n_va = build_own(a.own_repeat)
    print(f"own labeled frames: {n_tr} train (x{a.own_repeat}), {n_va} held out")
    head = yaml.safe_load(HEAD_YAML.read_text())
    as_list = lambda v: v if isinstance(v, list) else [v]
    rel = lambda v: [str((Path(head["path"]) / x).resolve()) for x in as_list(v)]
    trains = rel(head["train"]) + ([str(OWN_DS / "images/train")] if n_tr else [])
    data = write_yaml(RUNS / "_train.yaml", trains, rel(head["val"]))

    if a.val_only:
        best = RUNS / a.name / "weights" / "best.pt"
        if not best.exists():
            die(f"{best} not found")
        res = evaluate(best, data, n_va, a.device, a)
        (RUNS / a.name / "val_info.json").write_text(json.dumps(res, indent=2))
        print(json.dumps(res, indent=2))
        return

    base = a.weights or pick_base()
    print("base weights:", base)
    device = a.device
    epochs = a.epochs
    info = {"base": base, "device": device}

    def run(n, name):
        nonlocal device
        t0 = time.time()
        try:
            best = train(base, data, n, device, name, a)
        except Exception as e:                     # MPS op gaps / NaNs: fall back rather than stall
            if device == "cpu":
                raise
            print(f"!! training on {device} failed ({type(e).__name__}: {e}); retrying on cpu", file=sys.stderr)
            device = info["device"] = "cpu"
            t0 = time.time()
            best = train(base, data, n, device, name, a)
        return best, time.time() - t0

    if not epochs:
        _, sec = run(1, a.name + "_timing")
        epochs = int(max(1, min(a.max_epochs, (a.budget_min * 60 - sec) // (sec * 0.9))))
        info["timing_epoch_sec"] = round(sec, 1)
        print(f"one epoch (incl. startup + val) took {sec:.0f}s -> training {epochs} epochs on {device}")
        if device == "cpu":
            print("running on cpu: budget still applies, expect few epochs")

    best, sec = run(epochs, a.name)
    info.update(epochs=epochs, train_sec=round(sec, 1), best=str(best), device=device)

    info.update(evaluate(best, data, n_va, device, a))
    (RUNS / a.name / "train_info.json").write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))
    print("DONE")


if __name__ == "__main__":
    main()
