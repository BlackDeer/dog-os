# ml/ — the dog-head pose model and its data loop

Everything here runs on the Mac, inside `ml/.venv` (Python 3.12). Nothing in `ml/inbox/`, `ml/data/`,
`ml/out/`, `ml/datasets/`, `ml/runs/` is ever committed; only `public/models/dogpose.onnx` + `dogpose.json` are.

All commands are run from the repo root.

## 0. One-time setup

```sh
brew install uv ffmpeg
uv venv --python 3.12 ml/.venv
uv pip install --python ml/.venv/bin/python -r ml/requirements.txt
```

## 1. First model (no footage of your own needed)

```sh
ml/.venv/bin/python ml/prepare_dataset.py          # downloads ~4 GB once, builds ml/datasets/dog-head + ml/dog-head.yaml
nohup ml/.venv/bin/python ml/train_pose.py --budget-min 90 > ml/runs/train.log 2>&1 &
tail -f ml/runs/train.log                          # ends with DONE
ml/.venv/bin/python ml/export.py                   # -> public/models/dogpose.onnx, dogpose.json (+ dogpose.int8.onnx if it holds up)
```

`train_pose.py --budget-min N` times one epoch, then trains as many epochs as fit in N minutes (max 100).
`--epochs N` skips the timing run. On this M2 Pro one epoch is about 6 minutes on MPS, so a long run is
`--epochs 100` overnight. If MPS fails the script retries on CPU by itself.

What the dataset is made of, and why (details in `prepare_dataset.py` and `REPORT.md`):

| source | gives | note |
|---|---|---|
| Ultralytics Dog-Pose | nose, ear bases, ear tips, chin | its eye / throat / withers columns are **empty** |
| AP-10K canids | nose, **eyes** | the only eye supervision |
| COCO val2017 without dogs + blank frames | "no dog" | without these the model sees a dog in an empty room |
| crop-to-head copies of the two above | face fills the frame, darkened / blurred / noisy | simulates the phone view |

Keypoints a source does not annotate are written as `v=3` in train labels; `partial_labels.py` patches the
Ultralytics pose loss so `v=3` is ignored instead of being learned as "invisible". That patch is written against
`ultralytics==8.4.157` (pinned in `requirements.txt`).

## 2. The loop with your own clips

```sh
# 1. drop the zips shared from the phone into ml/inbox/, then:
ml/.venv/bin/python ml/ingest.py                   # -> ml/data/raw/<dog>/<clip>/{clip.webm,meta.json,frames/,frames.json}

# 2. the honest test: watch the overlay, read the numbers
ml/.venv/bin/python ml/eval_clips.py ml/data/raw/niles/<clip>/clip.webm
open ml/out/clip.overlay.mp4                       # is the yellow dot on the nose? if not, keep going

# 3. pseudo-label: confident frames -> ml/data/labeled/, the rest -> ml/data/queue/
ml/.venv/bin/python ml/prelabel.py

# 4. fix the queue by hand (Enter accept, X no dog, S skip, B back, V toggle a point, drag points and box corners)
python3 ml/labeler/serve.py                        # http://127.0.0.1:8765
python3 ml/labeler/serve.py --review               # optional: spot-check the auto-accepted ones

# 5. retrain: own frames are mixed in x8 automatically, ~20% of them are held out and scored separately
nohup ml/.venv/bin/python ml/train_pose.py --epochs 30 --weights ml/runs/dogpose/weights/best.pt --name dogpose_v2 > ml/runs/train_v2.log 2>&1 &

# 6. export (takes the newest ml/runs/*/weights/best.pt), then re-run step 2 and compare
ml/.venv/bin/python ml/export.py
```

Notes
- `ingest.py` is idempotent (a clip with `frames.json` is skipped; `--force` redoes it). Frames are extracted at
  2 fps and near-duplicates (perceptual hash within 4 bits of the last kept frame) are dropped. `<dog>` comes from
  `meta.json` → `dogName`, default `unknown`. Zips may hold `clip.webm` + `meta.json` or several `<name>.webm` + `<name>.json`.
- Frame files are named `<dog>__<clip>__<frame>.jpg`. `train_pose.py` uses the `<dog>__<clip>` part to hold out
  whole clips once there are 5 or more clips (fewer: it holds out single frames, which flatters the score).
- `eval_clips.py`, `prelabel.py` use the exported ONNX through the same letterbox + decoder the web app uses
  (`common.DogPose`), so they test what the phone runs. They exit with a clear message if no model is exported yet.
  `ingest.py` and the labeler need no model.
- Labels: YOLO pose, one row per dog: `0 cx cy w h` + 10 × `x y v`, normalized. Order: nose, left_eye, right_eye,
  left_ear_base, right_ear_base, left_ear_tip, right_ear_tip, chin, throat, withers. Left/right are the **dog's**.
  `v`: 2 visible, 0 not visible, 3 not annotated. An empty file means "no dog in this frame" (useful negatives: label
  the empty room, the owner walking past, the cat).
- Throat and withers have no training data yet. The labeler keeps them off (`v=3`) unless you switch them on
  (select with `8` / `9`, click to place). Until enough frames have them, ignore those two outputs.
- `ml/out/test/synthetic-test.zip` is a fake recorder zip (slideshow of val images) used to test the pipeline.
  Do not ingest it for training: those images are part of the val split.

## Files

| file | job |
|---|---|
| `common.py` | paths, keypoint order, letterbox, ONNX runner + decoder shared by all scripts |
| `prepare_dataset.py` | downloads, head-only relabel, head crops, negatives, writes `dog-head.yaml` |
| `partial_labels.py` | loss patch for datasets that annotate different keypoints |
| `train_pose.py` | fine-tune, time-boxing, own-data oversampling + held-out score, `--val-only` |
| `export.py` | ONNX export, `dogpose.json`, PyTorch/ORT parity, per-keypoint error, int8 trial |
| `ingest.py`, `eval_clips.py`, `prelabel.py`, `labeler/` | the data loop above |
| `REPORT.md` | what the current model is and how good it measured |

## Looking at sessions

```sh
ml/.venv/bin/python ml/replay.py            # camera | rebuilt screen, model overlay, attention trace, sound -> ml/out/replay/
python3 ml/analyze_pointer.py               # pointer shake, dropouts, confidence by position and distance
ml/.venv/bin/python ml/contact_sheet.py     # pointer-test clips: one annotated frame per target -> ml/out/sheets/
```

Clip format `dogos-clip/2`: every pose entry carries `screen`, a reference to what was showing
(`youtube`/`file`: id + playback time + player state; `game`: target x, y, radius, hits; `rest`). `capture` is
reserved for real screen video. Recorded keypoints are a cache of what the model did at the time; the video is
the ground truth.
