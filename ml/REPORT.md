# Dog-head pose model — report (2026-09-20)

**Real-world accuracy on front-camera footage is UNKNOWN.** Every number below comes from web photos
(Dog-Pose, AP-10K, COCO). No clip from the phone has been evaluated yet. The first thing to do when Niles's clips
arrive is `ml/ingest.py` → `ml/eval_clips.py` and look at the overlay video. Do not trust this model in the app
before that.

## What was trained

| | |
|---|---|
| Base model | `yolo26n-pose.pt` (Ultralytics 8.4.157, YOLO26 nano pose, 3.1 M params) |
| Head | YOLO26 dual head. The exported graph uses the **NMS-free one-to-one head** with top-k inside the graph |
| Input | 320 × 320, trained and exported at that size |
| Keypoints (10) | nose, left_eye, right_eye, left_ear_base, right_ear_base, left_ear_tip, right_ear_tip, chin, throat, withers |
| Epochs | 12 (time-boxed), cosine LR, mosaic 0.5 closed for the last 2 epochs, hsv_v 0.6, hsv_s 0.6, rotation ±20°, scale 0.6 |
| Device / time | MPS on the M2 Pro, no NaNs, no CPU fallback needed. 4,299 s ≈ **72 min** (≈ 6 min / epoch, 15.3k images) |
| Train set | 15,313 images: 6,773 Dog-Pose + 3,284 head crops of them; 980 AP-10K canids + 1,576 head crops; 2,400 COCO no-dog images + 300 synthetic blank frames |
| Val set | 2,143 images: 1,703 Dog-Pose val + 140 AP-10K canid val + 300 COCO no-dog images |

Validation was still improving slowly at epoch 12 (pose mAP50-95 0.80 → 0.83 over the last 4 epochs);
`--epochs 100` overnight should buy a little more. An earlier 1-epoch trial and one aborted run are not part of this model.

### Three things that differ from PLAN.md, and why

1. **Dog-Pose has no eye labels.** Its yaml lists 24 keypoints, but `left_eye`, `right_eye`, `withers` and `throat`
   are `v=0` in every one of its 8,476 label files (checked). Trained on Dog-Pose alone the model cannot learn eyes,
   and the app's attention score needs eyes. Eye supervision therefore comes from **AP-10K** canids (dog, wolf, fox,
   arctic fox: 980 train / 140 val images with nose + eyes). Because the two sources annotate different points, train
   labels mark "this source never annotates this point" as `v=3`, and `partial_labels.py` patches the Ultralytics
   keypoint loss so those points get neither a location loss nor a "not visible" target. Without the patch, 90% of the
   data would teach the model that eyes are invisible.
2. **Throat and withers are dead outputs.** No source annotates them. The model still emits 10 keypoints so the
   output shape will not change when labels for them exist, but their x, y and confidence are noise today.
   `dogpose.json` lists them under `keypointsNeverSupervised`. The app's attention and nose features do not need them.
3. **Background images were added.** The first trial model reported a 0.84-confidence dog on a blank grey frame,
   because every training image contained a (usually frame-filling) dog. 2,700 no-dog frames fixed that (see below).

## Accuracy on the val split

mAP from the Ultralytics validator at 320 px, 1,863 dogs. Pose mAP uses OKS with a uniform sigma of 0.1 for all 10
points (Ultralytics' default for non-COCO skeletons), which is lenient; read the pixel errors instead.

| head | pose mAP50 | pose mAP50-95 | box mAP50 | box mAP50-95 |
|---|---|---|---|---|
| **NMS-free one-to-one (what is exported)** | **0.949** | **0.826** | 0.964 | 0.652 |
| one-to-many + NMS (not exported) | 0.950 | 0.829 | 0.969 | 0.661 |

Per-keypoint error, measured by `export.py` on the **exported ONNX** through the same letterbox + decoder the web app
uses, in pixels of the 320 × 320 input, on dogs the model found (IoU ≥ 0.5, conf ≥ 0.5), annotated points only:

| keypoint | n | fp32 mean px | fp32 median px | fp32 p90 px | mean conf | int8 mean px | int8 median px |
|---|---|---|---|---|---|---|---|
| nose | 1658 | 6.14 | 3.23 | 7.98 | 0.96 | 6.19 | 3.41 |
| left_eye | 99 | 6.42 | 4.43 | 11.67 | 0.88 | 6.55 | 4.26 |
| right_eye | 106 | 6.23 | 3.95 | 11.90 | 0.89 | 6.47 | 4.43 |
| left_ear_base | 1348 | 9.90 | 6.50 | 16.30 | 0.88 | 9.78 | 6.45 |
| right_ear_base | 1285 | 10.78 | 6.79 | 17.29 | 0.87 | 10.69 | 7.07 |
| left_ear_tip | 1060 | 12.95 | 7.99 | 25.30 | 0.72 | 13.06 | 8.22 |
| right_ear_tip | 1030 | 13.07 | 8.15 | 24.21 | 0.72 | 13.07 | 8.51 |
| chin | 1404 | 8.45 | 5.68 | 14.54 | 0.90 | 8.51 | 5.77 |
| throat, withers | 0 | no ground truth anywhere | | | | | |

- Means are pulled up by a tail of gross misses (profile views, left/right swaps); medians are 3–4 px for nose and eyes.
- **Eye numbers rest on only ~100 val dogs** (AP-10K canids), all web photos. Treat them as weak evidence.
- Dogs found at conf ≥ 0.5: 89.8% of 1,863 (fp32), 88.8% (int8). The misses are mostly small or heavily occluded dogs.

"Is there a dog" per image, fp32, by threshold (1,843 dog images, 235 no-animal images, 65 images with another animal or a teddy bear):

| conf | dog images detected | false alarm, no animal in frame | false alarm, other animal in frame |
|---|---|---|---|
| 0.25 | 97.7% | 4.7% | 36.9% |
| 0.35 | 95.7% | 3.4% | 32.3% |
| 0.40 | 94.7% | 1.7% | 27.7% |
| **0.50 (recommended)** | **92.0%** | **0.9%** | **26.2%** |
| 0.60 | 88.5% | 0.9% | 21.5% |
| 0.70 | 81.9% | 0.4% | 13.8% |

The model calls roughly one cat / bear / teddy in four a dog. For a one-dog household that is acceptable; a home with a
cat should label some cat frames as "no dog" (`X` in the labeler).

## Export

| file | size | what |
|---|---|---|
| `public/models/dogpose.onnx` | **10.81 MB** | fp32, opset 17, static `[1,3,320,320]` → `[1,20,36]`, simplified |
| `public/models/dogpose.int8.onnx` | **3.05 MB** | onnxruntime dynamic int8 (QUInt8 weights). Kept: nose/eye mean error within 0.25 px of fp32, detection −0.9 pt |
| `public/models/dogpose.json` | 4 KB | decoder contract, written from the real ONNX graph |

- **End-to-end, NMS-free**: rows of `[x1,y1,x2,y2,conf,cls, 10 × (x,y,conf)]`, sorted by conf descending (verified),
  coordinates in pixels of the letterboxed 320 input, keypoint conf already sigmoid-ed. `max_det` was set to 20, so the
  output is 20 rows instead of 300. In this Ultralytics version the NMS-free head must be selected with `nms=False`
  (export, predict and val); the default is the other head.
- **PyTorch vs onnxruntime parity** on 10 val images (same letterboxed input, same head): max keypoint difference
  0.0001 px, keypoint-confidence difference 0.0000, detection-confidence difference 0.00001, box difference ≤ 0.0001 px
  on 8 images and 0.63 / 1.15 px on two.
- Ops in the graph: Add, Cast, Concat, Conv, Expand, Flatten, GatherElements, MatMul, MaxPool, Mod, Mul, ReduceMax,
  Reshape, Resize, Sigmoid, Slice, Softmax, Split, Sub, TopK, Transpose, Unsqueeze. int8 adds ConvInteger and
  DynamicQuantizeLinear.
- **onnxruntime-web smoke test**: both files load and run under `onnxruntime-web` 1.22 with the WASM backend in Node
  (single thread), output `[1,20,36]`, flat grey input → conf 0.001. Not yet run in a browser, on WebGPU, or on the phone.

### Speed (this Mac, pure inference, no pre/post-processing)

| runtime | fp32 | int8 |
|---|---|---|
| onnxruntime CPU, 4 threads | **8.7 ms / frame** | 10.9 ms |
| onnxruntime CPU, 1 thread | 23.4 ms | 13.8 ms |
| onnxruntime-web WASM in Node, 1 thread | 48.6 ms | 49.3 ms |

int8 is smaller but not faster under WASM, and it cannot run on the WebGPU backend. **Ship fp32**; int8 is there
only if 7.8 MB of download ever matters. The phone will be several times slower than these numbers; the 10 fps
PLAY/PICK budget is unverified until measured on the device.

## What was actually run, and what was not

Ran end to end on this machine:
- `prepare_dataset.py`, `train_pose.py` (MPS, 12 epochs), `export.py` (parity, per-keypoint error, threshold sweep, int8, benchmarks).
- `ingest.py` on a synthetic recorder zip (`clip.webm` VP8 640×480 15 fps + `meta.json`, made with ffmpeg from val
  images, kept at `ml/out/test/synthetic-test.zip`), on a multi-pair zip (`<name>.webm` + `<name>.json`, one without
  `dogName` → `unknown`), and a second time to confirm finished clips are skipped.
- `eval_clips.py` on that clip: overlay written, nose and eyes land on the faces, the blank segment reads "no dog".
  Its numbers (detection 68%, median nose jitter 1.8 px) describe a slideshow of val photos with hard cuts and say nothing about Niles.
- `prelabel.py` (twice; the second run is a no-op) and the labeler's server API (list / item / image / accept / no-dog,
  path traversal rejected), plus a headless-Chrome screenshot of the page showing a frame with its points and box.

Not tested:
- The labeler's **mouse and keyboard interaction** (dragging, toggling, Enter / X / S) was never driven in a real browser.
- Anything on real front-camera footage, in a real browser, with WebGPU, or on the Android phone.
- `train_pose.py` with own labeled frames mixed in (oversampling + held-out report) and its automatic CPU fallback:
  the code paths exist but never ran, because there is no own data yet and MPS did not fail.
- The `v=3` loss patch is tied to Ultralytics 8.4.157 internals; a different version needs a re-check.

## Licensing (fine for a personal prototype, not for selling)

- Dog-Pose images come from Stanford Dogs / ImageNet: **research use only**.
- Ultralytics code and the weights it produces (including `dogpose.onnx`) are **AGPL-3.0** unless an enterprise
  license is bought. A closed product cannot ship these weights.
- Added in this build: AP-10K (CC BY 4.0 according to its Hugging Face mirror; cite Yu et al., NeurIPS 2021 Datasets
  and Benchmarks; its images are web photos) and COCO val2017 (annotations CC BY 4.0, images under their individual
  Flickr licenses). Neither changes the conclusion.
- TinyCLIP (the other model in the app) is MIT.
- Before this becomes a product, retrain on footage you own (Niles plus purchased camera recordings, labeled with
  nose / eyes / ears only) using an Apache-licensed trainer such as MMPose RTMPose. The app only sees an ONNX file with
  a fixed output contract (`dogpose.json`), so that swap touches nothing else.
