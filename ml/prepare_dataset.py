"""Build the 10-keypoint dog-head dataset.

  ml/.venv/bin/python ml/prepare_dataset.py [--crop-frac 0.5] [--seed 0] [--force] [--no-ap10k]

Sources
  * Ultralytics Dog-Pose (StanfordExtra): nose, ear bases, ear tips, chin. Its eye / throat / withers
    columns exist but are NEVER annotated (v=0 in every file), so on its own it cannot teach eyes.
  * AP-10K canids (dog, fox, wolf, arctic fox; CC BY 4.0, YOLO-format mirror LibreYOLO/ap10k-pose on
    Hugging Face, 2.8 GB): left_eye, right_eye, nose. This is where eye supervision comes from.
  * COCO val2017 images without a dog (YOLO-format mirror LibreYOLO/coco-val2017, 0.8 GB) + synthetic blank
    frames, as backgrounds: 2400 + 300 in train, 300 in val. People, rooms, cats, furniture = "no dog".
Keypoints a source never annotates are written as v=3 in TRAIN labels (see partial_labels.py) and v=0 in val.
Train also gets crop-to-head copies (face fills the frame, with blur/noise/darkening baked in).

Output: ml/datasets/dog-head/{images,labels}/{train,val} and ml/dog-head.yaml
"""
from __future__ import annotations

import argparse
import os
import random
import shutil
from pathlib import Path

import cv2
import yaml

import numpy as np

from common import DATASETS, FLIP_IDX, HEAD_DS, HEAD_KPTS, HEAD_YAML, SRC_DS, die, ultralytics_settings

MIN_VISIBLE = 3
UNKNOWN = 3
AP10K = DATASETS / "ap10k-pose"
AP10K_URL = "https://huggingface.co/datasets/LibreYOLO/ap10k-pose/resolve/main/ap10k-pose.zip"
AP10K_CANIDS = {"arctic fox", "dog", "fox", "wolf"}
COCO = DATASETS / "coco" / "coco-val2017"
COCO_URL = "https://huggingface.co/datasets/LibreYOLO/coco-val2017/resolve/main/coco-val2017.zip"
COCO_DOG = 16
IMG_EXT = {".jpg", ".jpeg", ".png"}


def download_ap10k():
    if (AP10K / "images" / "train").exists():
        return
    ultralytics_settings()
    from ultralytics.utils.downloads import download as ul_download
    print("downloading AP-10K (2.8 GB) for eye supervision ...")
    ul_download(AP10K_URL, dir=DATASETS, unzip=True, delete=True)
    if not (AP10K / "images" / "train").exists():
        die(f"AP-10K download finished but {AP10K}/images/train is missing; look inside {DATASETS}")


def download():
    if (SRC_DS / "images" / "train").exists():
        return
    ultralytics_settings()
    import ultralytics
    from ultralytics.utils.downloads import download as ul_download
    cfg = Path(ultralytics.__file__).parent / "cfg/datasets/dog-pose.yaml"
    url = yaml.safe_load(cfg.read_text())["download"]
    DATASETS.mkdir(parents=True, exist_ok=True)
    ul_download(url, dir=DATASETS, unzip=True, delete=True)
    if not (SRC_DS / "images" / "train").exists():
        die(f"download finished but {SRC_DS}/images/train is missing; look inside {DATASETS}")


def source_index_map() -> list[int]:
    """Indices of HEAD_KPTS inside the original keypoint order, read from the dataset yaml (not assumed)."""
    import ultralytics
    cfg = yaml.safe_load((Path(ultralytics.__file__).parent / "cfg/datasets/dog-pose.yaml").read_text())
    assert cfg["kpt_shape"] == [24, 3], cfg["kpt_shape"]
    names = cfg["kpt_names"][0]
    missing = [k for k in HEAD_KPTS if k not in names]
    if missing:
        die(f"dog-pose.yaml has no keypoints named {missing}; names are {names}")
    return [names.index(k) for k in HEAD_KPTS]


def link(src: Path, dst: Path):
    if dst.exists():
        return
    try:
        os.link(src, dst)           # hardlink: no extra disk, and label lookup by path still works
    except OSError:
        shutil.copy2(src, dst)


def read_rows(path: Path, nk_src: int, src_of: list[int | None], keep_cls: set[int] | None = None):
    """Read a YOLO pose label file with nk_src keypoints -> [(cx, cy, w, h, [[x, y, v] * 10])], normalized.

    src_of[i] is the source column of head keypoint i, or None when this source never annotates it (v=UNKNOWN).
    """
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) != 5 + nk_src * 3:
            continue
        f = [float(v) for v in p]
        if keep_cls is not None and int(f[0]) not in keep_cls:
            continue
        k = f[5:]
        kpts = []
        for i in src_of:
            if i is None:
                kpts.append([f[1], f[2], UNKNOWN])      # parked at the box centre, see partial_labels.py
                continue
            x, y, v = k[i * 3:i * 3 + 3]
            v = int(round(v))
            if v <= 0 or not (0 <= x <= 1 and 0 <= y <= 1) or (x == 0 and y == 0):
                x, y, v = 0.0, 0.0, 0
            kpts.append([x, y, 2 if v else 0])
        rows.append((f[1], f[2], f[3], f[4], kpts))
    return rows


def fmt(rows, train: bool) -> str:
    out = []
    for cx, cy, w, h, kpts in rows:
        vals = [f"{cx:.6f}", f"{cy:.6f}", f"{w:.6f}", f"{h:.6f}"]
        for x, y, v in kpts:
            if v == UNKNOWN and not train:              # the validator would score v=3 as an annotation
                x, y, v = 0.0, 0.0, 0
            vals += [f"{x:.6f}", f"{y:.6f}", str(int(v))]
        out.append("0 " + " ".join(vals))
    return "\n".join(out) + ("\n" if out else "")


def annotated(k) -> bool:
    return k[2] in (1, 2)


def head_crop(img, rows, rng: random.Random, scale_range):
    """Crop tightly round one dog's annotated head keypoints. -> (crop, new_rows) or None."""
    H, W = img.shape[:2]
    cands = [r for r in rows if sum(annotated(k) for k in r[4]) >= MIN_VISIBLE]
    if not cands:
        return None
    target = rng.choice(cands)
    xs = [k[0] * W for k in target[4] if annotated(k)]
    ys = [k[1] * H for k in target[4] if annotated(k)]
    x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
    side = max(x2 - x1, y2 - y1, 0.04 * max(W, H))
    # the annotated points span 1/scale of the crop: small = face fills the frame and ears may clip
    scale = rng.uniform(*scale_range)
    aspect = rng.choice([1.0, 4 / 3, 4 / 3, 3 / 4])          # phone frames are 4:3 either way up
    cw, ch = side * scale * max(aspect, 1.0), side * scale * max(1 / aspect, 1.0)
    cx = (x1 + x2) / 2 + rng.uniform(-0.15, 0.15) * cw
    cy = (y1 + y2) / 2 + rng.uniform(-0.15, 0.15) * ch
    X1, Y1 = int(max(0, round(cx - cw / 2))), int(max(0, round(cy - ch / 2)))
    X2, Y2 = int(min(W, round(cx + cw / 2))), int(min(H, round(cy + ch / 2)))
    nw, nh = X2 - X1, Y2 - Y1
    if nw < 32 or nh < 32:
        return None
    new_rows = []
    for r in rows:
        bx1, by1 = (r[0] - r[2] / 2) * W, (r[1] - r[3] / 2) * H
        bx2, by2 = (r[0] + r[2] / 2) * W, (r[1] + r[3] / 2) * H
        ix1, iy1, ix2, iy2 = max(bx1, X1), max(by1, Y1), min(bx2, X2), min(by2, Y2)
        if ix2 - ix1 < 8 or iy2 - iy1 < 8:
            continue
        # box = the part of the dog that is still visible inside the crop
        ncx, ncy = ((ix1 + ix2) / 2 - X1) / nw, ((iy1 + iy2) / 2 - Y1) / nh
        kpts = []
        for x, y, v in r[4]:
            px, py = x * W, y * H
            if v == UNKNOWN:
                kpts.append([ncx, ncy, UNKNOWN])
            elif v > 0 and X1 <= px < X2 and Y1 <= py < Y2:
                kpts.append([(px - X1) / nw, (py - Y1) / nh, v])
            else:
                kpts.append([0.0, 0.0, 0])
        nvis = sum(annotated(k) for k in kpts)
        if r is target and nvis < MIN_VISIBLE:
            return None
        if r is not target and nvis < 1:
            continue
        new_rows.append((ncx, ncy, (ix2 - ix1) / nw, (iy2 - iy1) / nh, kpts))
    return img[Y1:Y2, X1:X2], new_rows


def degrade(img, rng: random.Random):
    """Make a clean photo look like a dim indoor phone frame: darker, softer, noisier, more compressed."""
    out = img
    if rng.random() < 0.5:                                   # dim room / evening light
        gamma, gain = rng.uniform(1.2, 2.4), rng.uniform(0.6, 1.0)
        out = (np.power(out.astype(np.float32) / 255.0, gamma) * gain * 255.0).clip(0, 255).astype(np.uint8)
    if rng.random() < 0.2:                                   # 640x480 sensor stretched over a big face
        h, w = out.shape[:2]
        f = rng.uniform(0.35, 0.7)
        out = cv2.resize(cv2.resize(out, (max(8, int(w * f)), max(8, int(h * f)))), (w, h))
    if rng.random() < 0.35:                                  # motion / focus blur
        k = rng.choice([3, 5, 7])
        out = cv2.GaussianBlur(out, (k, k), 0)
    if rng.random() < 0.4:                                   # sensor noise
        noise = np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(4, 16), out.shape)
        out = (out.astype(np.float32) + noise).clip(0, 255).astype(np.uint8)
    q = rng.randint(35, 70) if rng.random() < 0.3 else 92    # ~800 kbps WebM is blocky
    return out, q


def convert(name, img_root: Path, lab_root: Path, nk_src, src_of, keep_cls, crop_frac, n_crops, scale_range, rng, prefix=""):
    stats = {}
    for split in ("train", "val"):
        train = split == "train"
        for sub in ("images", "labels"):
            (HEAD_DS / sub / split).mkdir(parents=True, exist_ok=True)
        imgs = sorted(p for p in (img_root / split).iterdir() if p.suffix.lower() in IMG_EXT)
        n_img = n_crop = n_drop = 0
        for p in imgs:
            rows = read_rows(lab_root / split / f"{p.stem}.txt", nk_src, src_of, keep_cls)
            if keep_cls is not None and not rows:
                continue                                      # image has none of the wanted species
            n_img += 1
            stem = prefix + p.stem
            link(p, HEAD_DS / "images" / split / (stem + p.suffix))
            (HEAD_DS / "labels" / split / f"{stem}.txt").write_text(fmt(rows, train))
            if not train or rng.random() >= crop_frac:
                continue
            img = cv2.imread(str(p))
            for c in range(n_crops):
                res = head_crop(img, rows, rng, scale_range) if img is not None else None
                if res is None:
                    n_drop += 1
                    continue
                crop, new_rows = res
                crop, q = degrade(crop, rng)
                tag = "_headcrop" if c == 0 else f"_headcrop{c}"
                cv2.imwrite(str(HEAD_DS / "images" / split / f"{stem}{tag}.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, q])
                (HEAD_DS / "labels" / split / f"{stem}{tag}.txt").write_text(fmt(new_rows, True))
                n_crop += 1
        stats[split] = dict(images=n_img, head_crops=n_crop, crops_dropped_lt3_visible=n_drop)
        print(name, split, stats[split])
    return stats


def add_negatives(n_train: int, n_val: int, n_synth: int, rng: random.Random):
    """Frames with NO dog. Without them every training image contains a frame-filling dog and the model
    happily reports a 0.8-confidence dog on a blank wall (seen in the first run)."""
    if not (COCO / "images" / "val2017").exists():
        ultralytics_settings()
        from ultralytics.utils.downloads import download as ul_download
        print("downloading COCO val2017 (0.8 GB) for no-dog backgrounds ...")
        ul_download(COCO_URL, dir=COCO.parent, unzip=True, delete=True)
    imgs = []
    for p in sorted((COCO / "images" / "val2017").glob("*.jpg")):
        lab = COCO / "labels" / "val2017" / f"{p.stem}.txt"
        classes = {int(l.split()[0]) for l in lab.read_text().splitlines() if l.strip()} if lab.exists() else set()
        if COCO_DOG not in classes:
            imgs.append(p)
    rng.shuffle(imgs)
    picks = {"train": imgs[:n_train], "val": imgs[n_train:n_train + n_val]}
    for split, ps in picks.items():
        for i, p in enumerate(ps):
            stem = f"neg_{p.stem}"
            if split == "train" and i % 3 == 0:              # a third look like the phone camera at night
                out, q = degrade(cv2.imread(str(p)), rng)
                cv2.imwrite(str(HEAD_DS / "images" / split / f"{stem}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, q])
            else:
                link(p, HEAD_DS / "images" / split / f"{stem}.jpg")
            (HEAD_DS / "labels" / split / f"{stem}.txt").write_text("")
    nrng = np.random.default_rng(rng.randrange(1 << 30))
    for i in range(n_synth):                                 # blank walls, dark rooms, covered lens
        h, w = rng.choice([(480, 640), (640, 480)])
        base = np.array([rng.uniform(0, 255) * rng.choice([0.15, 0.5, 1.0])] * 3) + nrng.normal(0, 12, 3)
        gx = np.linspace(0, rng.uniform(-60, 60), w)[None, :, None] + np.linspace(0, rng.uniform(-60, 60), h)[:, None, None]
        im = base[None, None, :] + gx + nrng.normal(0, rng.uniform(0, 14), (h, w, 3))
        im = im.clip(0, 255).astype(np.uint8)
        if rng.random() < 0.5:
            im = cv2.GaussianBlur(im, (5, 5), 0)
        cv2.imwrite(str(HEAD_DS / "images" / "train" / f"neg_synth_{i:04d}.jpg"), im, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(40, 92)])
        (HEAD_DS / "labels" / "train" / f"neg_synth_{i:04d}.txt").write_text("")
    print("negatives", {k: len(v) for k, v in picks.items()}, "synthetic train:", n_synth)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop-frac", type=float, default=0.5, help="fraction of Dog-Pose train images that also get a head crop")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--force", action="store_true", help="rebuild ml/datasets/dog-head from scratch")
    ap.add_argument("--no-ap10k", action="store_true", help="Dog-Pose only (the model will then have NO usable eye outputs)")
    ap.add_argument("--negatives", type=int, default=2400, help="no-dog COCO images added to train (0 = none)")
    a = ap.parse_args()

    download()
    idx = source_index_map()
    print("head keypoints <- Dog-Pose source indices:", dict(zip(HEAD_KPTS, idx)))
    if a.force and HEAD_DS.exists():
        shutil.rmtree(HEAD_DS)
    rng = random.Random(a.seed)

    # Which Dog-Pose columns are ever annotated? (eyes / throat / withers are not; checked, not assumed)
    seen = [False] * 24
    for f in sorted((SRC_DS / "labels" / "train").glob("*.txt"))[:2000]:
        for line in f.read_text().splitlines():
            v = line.split()[5:]
            for k in range(24):
                seen[k] = seen[k] or float(v[k * 3 + 2]) > 0
    src_of = [i if seen[i] else None for i in idx]
    print("Dog-Pose never annotates:", [n for n, i in zip(HEAD_KPTS, src_of) if i is None])
    # scale: annotated points are ears+nose+chin = the whole head, so 1.25-2.2x is a face-filling frame
    convert("dog-pose", SRC_DS / "images", SRC_DS / "labels", 24, src_of, None, a.crop_frac, 1, (1.25, 2.2), rng)

    if not a.no_ap10k:
        download_ap10k()
        cfg = yaml.safe_load((AP10K / "ap10k-pose.yaml").read_text())
        keep = {i for i, n in cfg["names"].items() if n in AP10K_CANIDS}
        kn = cfg["keypoints"]
        src_of = [kn.index(n) if n in kn else None for n in HEAD_KPTS]
        print("AP-10K classes kept:", sorted(cfg["names"][i] for i in keep), "| annotates:", [n for n in HEAD_KPTS if n in kn])
        # scale: annotated points are only eyes+nose (the middle of the face), so the crop must be wider.
        # every canid image gets two different head crops: they are the only source of eye labels.
        convert("ap10k", AP10K / "images", AP10K / "labels", len(kn), src_of, keep, 1.0, 2, (2.2, 4.0), rng, prefix="ap10k_")

    if a.negatives:
        add_negatives(a.negatives, 300, 300, rng)

    HEAD_YAML.write_text(yaml.safe_dump({
        "path": str(HEAD_DS),
        "train": "images/train",
        "val": "images/val",
        "kpt_shape": [len(HEAD_KPTS), 3],
        "flip_idx": FLIP_IDX,
        "names": {0: "dog"},
        "kpt_names": {0: HEAD_KPTS},
    }, sort_keys=False))
    print("wrote", HEAD_YAML)


if __name__ == "__main__":
    main()
