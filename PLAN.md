# Dog OS — build plan (v1)

A tablet-for-toddlers experience for small dogs. First user: Niles. First device: the spare Android phone.
This file is the spec for the build one-shot. Build everything in "Scope", in the order in "Build order".

## Inputs from the owner (none block the build)

1. **Clips of Niles, recorded with the app itself.** The recorder (Scope 7) ships in the first deploy, before
   the pose model exists, precisely so this is possible. Record two or three clips with the phone mounted
   where it will live, one in daylight and one in evening light, share them to the Mac, and drop the zips
   in `ml/inbox/`. `ml/ingest.py` and `ml/eval_clips.py` take it from there. Until clips arrive the pose model
   is trained and scored on Dog-Pose only and its real-world accuracy is unknown; say so in `ml/REPORT.md`.
2. **The phone's model and Android version.** It decides whether WebGPU is available and what frame rates
   are realistic.

## Build environment (checked 2026-09-20)

- Mac: Apple M2 Pro, 179 GB free, Node 23, ffmpeg, `gh` logged in as `BlackDeer`. Train with `device="mps"`.
- System Python is 3.14, which PyTorch/Ultralytics may not have wheels for. Create `ml/.venv` on
  **Python 3.12** (`uv venv --python 3.12`, installing `uv` via brew if missing). Never install into
  system Python.
- Android SDK exists at `~/Library/Android/sdk` but is not needed. `adb` from its `platform-tools` is
  handy for `chrome://inspect` remote debugging of the phone.
- Repo: `BlackDeer/dog-os`, **public** (GitHub Pages on a free plan requires it). Owner approved creating
  it and deploying to Pages on 2026-09-20. `ml/inbox/`, `ml/data/`, `ml/out/`, datasets and `.venv` are gitignored so
  no footage of the home is ever pushed; only the exported `dogpose.onnx` is committed.

## Decisions already made

1. **PWA, not a native Android app.** Vite + React + TypeScript, deployed to GitHub Pages (HTTPS is required
   for camera access), installed to the phone's home screen from Chrome. Reasons: front camera, in-browser ML,
   YouTube embeds, fullscreen and wake lock all work in Chrome on Android; it can be built and tested entirely
   on the Mac with a webcam; no Gradle/signing/sideloading. Kiosk behavior comes from Android's built-in
   **screen pinning** plus in-app fullscreen + Wake Lock. If a true launcher is ever needed, wrap the same
   code with Capacitor later. Nothing in v1 blocks that.
2. **Touch first, camera second.** A wet dog nose registers on a capacitive screen, so v1 input is plain
   touch made forgiving. Camera nose-tracking ships as a second, experimental input (see Sensing): the
   keypoint model finds the nose well, but one camera can't see depth, so the screen mapping is approximate.
3. **All ML runs on the device. No LLM or hosted API anywhere.** Two small ONNX models, both run in the
   browser with onnxruntime-web / transformers.js (WebGPU where available, WASM fallback):
   a dog keypoint model we train on the Mac (6–12 MB) and TinyCLIP int8 (~24 MB). Total under 40 MB, cached
   by the service worker so the app works offline apart from YouTube itself.
4. **Content is YouTube embeds in v1.** Purchased/licensed camera recordings come later; the catalog schema
   already has a `source` field so self-hosted MP4/HLS slots in without a rewrite.
5. **No backend, no keys.** All state on the device. Camera frames leave the phone only as clips the owner
   chose to record, reviewed, and shared by hand.

## Scope

### 1. Dog mode (the default screen)
- Fullscreen, wake-locked, no visible chrome. Nothing a nose can hit leads out of dog mode.
- **Owner gate**: press-and-hold a corner for 3 s, then solve a tiny arithmetic prompt. Only way into owner mode.
- **Paw/nose-friendly touch rules**, implemented once in a `useDogTouch` hook and used everywhere:
  any pointerdown counts (no click/tap timing), multi-touch collapses to the first contact, hit targets
  are at least 35% of the short screen edge, hit-testing is generous (nearest target within a radius wins),
  300 ms debounce, drags and long-presses are ignored, no gestures, no scrolling.
- Palette for anything dogs must see: **blue and yellow on dark**. Dogs are dichromats; red/green targets
  are close to invisible to them.
- Audio: every touch gets a sound. Global volume cap in settings.

### 2. Channels (watch)
- `catalog.json`: `{ id, source: "youtube" | "file", ref, title, tags[], durationSec?, embedding? }`.
- Seed ~30 videos across tags: `nature-sounds`, `trees-forest`, `birds`, `squirrels`, `dogs-playing`,
  `fish-tank`, `rain`, `farm`. **Do not write video IDs from memory.** Find them by search during the
  build and verify each one with the YouTube oEmbed endpoint
  (`https://www.youtube.com/oembed?url=...&format=json`); drop any that fail or disallow embedding.
  A `scripts/verify-catalog.ts` does this and runs in CI.
- Player: YouTube IFrame API, controls hidden, a transparent overlay div on top so touches never reach
  the iframe (a nose must not be able to open YouTube).
- **Autoplay**: Chrome blocks unmuted autoplay without a user gesture. Create the one player instance
  inside the owner's *Start session* tap, set `allow="autoplay"` on the iframe, and reuse that instance with
  `loadVideoById` for every rotation. If a video still starts paused, start it muted and ramp volume up.
- **Known YouTube limits** (accepted for the prototype): covering the player breaks YouTube's embed terms,
  ads can play and can't be skipped through the shield, and ads are loud. This is the real reason the `file`
  source exists. Ship 3–5 self-hosted clips (own footage or CC0) in v1 so the path is exercised, and let
  settings restrict a session to `file` sources only.
- **Rotation**: when the engagement score stays under threshold for N seconds (default 45), crossfade to the
  next pick. When the dog is absent for 5 min, dim and play quiet audio only; wake when a dog reappears.

### 3. Sensing: one model for nose and attention
- **Model**: Ultralytics YOLO nano pose (~3M params) fine-tuned on the Ultralytics
  **Dog-Pose** dataset (8.4k images, 24 keypoints including `nose`, `left_eye`, `right_eye`, ear bases and
  tips, `chin`, `throat`, `withers`). One forward pass gives the dog box and the keypoints, so it replaces
  the generic object detector as well. Prefer `yolo26n-pose` (what the Dog-Pose docs now recommend; confirm
  at build time that its head is NMS-free, which removes NMS from the JS post-processing). Fall back to
  `yolo11n-pose` plus a small JS NMS.
- **Domain gap is the main technical risk.** Dog-Pose is whole dogs in daylight photos. The phone sees a
  face filling the frame, from below, indoors, through a wide lens. So: (a) train on **head keypoints only**
  (nose, eyes, ear bases, ear tips, chin, throat, withers = 10) by rewriting the label files; (b) add a
  crop-to-head augmentation so half the training samples are face-only, plus brightness/blur/noise
  augmentation; (c) evaluate on the owner's own clips (Scope 7) with
  `ml/eval_clips.py`, which writes an overlay video to `ml/out/`. If the nose dot isn't on the nose in those clips,
  stop and fix the model before building anything that depends on it.
- **As built (2026-09-20)**: `yolo26n-pose`, NMS-free export, 12 epochs at 320 px on MPS in 72 min; 10.8 MB
  fp32 ONNX (int8 kept in `ml/models/`, no faster under WASM). Val nose error 6.1 px mean / 3.2 px median at
  320 px; dog detected in 92% of dog images, 0.9% false alarms on empty frames, **26% on frames with another
  animal** (cats, teddies). Three things the plan had wrong: Dog-Pose has **no eye labels**, so eye supervision
  comes from ~1k canid images in AP-10K, via a patched keypoint loss that ignores never-labeled points
  (`ml/partial_labels.py`, pinned to Ultralytics 8.4.157); `throat` and `withers` are labeled nowhere and are
  dead outputs; and no-dog COCO images had to be added, because a model trained only on dogs sees a dog in a
  blank frame. Since eyes are the weakest points, attention falls back to the ear bases when eyes drop out.
  Full numbers: `ml/REPORT.md`. Real-world accuracy on front-camera footage: still unknown.
- **Training, on the Mac** (`ml/train_pose.py`): `pip install ultralytics`, then
  `YOLO("yolo26n-pose.pt").train(data="dog-head.yaml", epochs=100, imgsz=320, device="mps")`.
  The dataset auto-downloads. Train at 320 px because the phone runs it at 320 px. Export with
  `model.export(format="onnx", imgsz=320, simplify=True)` (fp32; fp16 export needs CUDA and the WASM
  backend handles fp16 poorly), then try onnxruntime int8 dynamic quantization and keep it only if nose/eye
  error holds. Output to `public/models/dogpose.onnx`, expect 6–12 MB.
  Record mAP and per-keypoint error for nose and eyes in `ml/REPORT.md`. If MPS training misbehaves,
  fall back to `device="cpu"` with fewer epochs rather than stalling the build.
- **Runtime**: onnxruntime-web in a Web Worker, front camera at 320 px. Frame rate follows the
  screen, because the phone is also decoding video and will be on a charger for hours: 1 fps in REST,
  2 fps in WATCH (attention changes slowly), up to 10 fps only in PLAY/PICK with the nose cursor on.
  Back off further if inference time climbs (thermal throttling). Keypoints smoothed with a One Euro filter.
- **Nose tracking is coarse by geometry, so design for zones, not pixels.** The front camera sits on the
  bezel looking straight out with roughly ±40° of view. A nose within a few cm of the glass is outside that
  cone over most of the screen, which is fine because at that range the touchscreen takes over. The camera
  covers the other case: a dog 15–60 cm back, where parallax makes pixel-accurate pointing impossible from
  one lens. So the nose cursor resolves to a **3×2 zone grid** with hysteresis, and games and PICK consume
  zones. Hand-off rule: a touch always wins over the camera, and a touch marks the dog `touching` even when
  the face has left the frame.
- **Calibration** (owner mode): hold a treat about a forearm's length in front of the left edge, center and
  right edge of the screen in turn, tap to capture each. That fits the horizontal map and the dog's
  typical distance. Uncalibrated default: mirrored camera x split into thirds.
- **Attention tracking, no extra model**: the camera sits beside the screen, so "facing the camera" is
  "facing the screen". Score per frame from keypoint geometry:
  both eyes and nose above confidence; nose offset between the eyes (yaw) measured against a **learned
  neutral** rather than zero, since the camera is ~7 cm off the screen center and a dog watching the middle
  of the screen is looking past the lens (neutral comes from calibration, else the session's running median); eye line roughly
  level (roll); eye-to-eye distance as a proximity term; low frame-to-frame motion as a stillness term.
  Combine to 0–1, EMA-smooth, and expose discrete states `absent | present | attending | touching`.
  This is head orientation, which is what the hardware can honestly measure; it is not eye gaze.
- **Arousal, also free**: keypoint motion energy over a 5 s window gives `calm | alert | worked-up`.
  Sustained `worked-up` is not rewarded as engagement; it triggers a switch to a calm tag and is logged.
  The bandit's reward is attention × calm, so it learns what settles Niles, not what makes him bark at
  squirrels.
- **Personalization hook (phase 2, not built now)**: owner mode can record labeled keypoint sequences of
  Niles ("watching" / "not watching"); a logistic regression over the geometry features, trained in-browser,
  would then replace the hand-set weights. Leave the feature vector and logging in place for it.
- Dev mode accepts a video file as the camera source, including any recorded clip, so the whole loop is
  testable at a desk against the real dog. Until own clips exist, use one stock dog clip fetched by script.

### 4. Picking what plays
- Thompson-sampling bandit over **tags**, with a per-video bonus. Reward = mean engagement while playing.
- Priors seeded for Niles: `nature-sounds` and `trees-forest` start ahead.
- 15% forced exploration so the catalog doesn't collapse to one channel.
- **Embedding + search model**: `onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX`, int8, ~24 MB,
  loaded through transformers.js. One model does both jobs, which is required: text queries only match
  image vectors that came from the same CLIP. The published ONNX is a single combined graph (checked at
  build time: no separate tower files exist), so the app runs the whole 24 MB model and feeds the unused
  tower a dummy input. The model is loaded lazily, in owner mode only; dog mode never touches it.
  - Build time (`scripts/embed-catalog.ts`, Node, same model): per video, pull 4–8 thumbnails/frames,
    embed, mean-pool, L2-normalize, store as base64 float16 in `catalog.json`.
  - On device: cosine similarity in plain JS. At 30–3,000 items a flat scan is the vector DB.
  - Uses: "more like what held attention" (centroid of top-engagement videos feeds the bandit's
    exploration picks), owner text search ("birds in snow"), and auto-tag suggestions in the catalog editor
    by zero-shot against the tag list. The text tower loads lazily, only in owner mode.
  - This CLIP is tiny and coarse. It separates birds from forest from fish; it will not rank two forest
    videos sensibly. If that proves limiting, swap to MobileCLIP2-S0 (vision tower ~43 MB) behind the same
    `Embedder` interface and re-run the embed script.

### 5. Games
- **Bop**: a blue/yellow critter drifts across the screen; any touch near it squeaks, bursts, respawns.
  Speed adapts to hit rate. Every 5th hit flashes a "TREAT" cue for the owner.
- **Chase**: a ball that flees the touch point and bounces. No fail state.
- Both accept touch and, when the nose cursor is enabled, nose zones (critter in the zone the nose has
  dwelt in for 400 ms = bop).
- Both report touches per minute as the engagement reward, so games and channels share one bandit.
- Auto-schedule: a game interlude is offered when engagement is high but falling.

### 6. Owner mode
- **Dashboard**: today's screen time, engagement by tag, top videos, touches per game, model fps and nose-tracking confidence.
- **Training**: clicker button, cue cards (sit, down, stay, touch, place) with a rep counter and a
  streak log, and a "touch target" mode that shows one giant target to teach Niles to nose the screen
  on cue. That last one is the bridge between training and everything else in the app.
- **Settings**: session length limit and cooldown, quiet hours, volume cap, rotation threshold,
  nose cursor on/off, nose calibration, dev mode (video file as camera), catalog editor (paste a YouTube URL,
  verify, tag, add).

### 7. Clip recorder (training data)
The point: get real front-camera footage of real dogs, starting with Niles, later from other owners, to
train and test the pose and attention models on the view the app has.

- **Capture**: `MediaRecorder` on the same `getUserMedia` stream the pose worker uses (one camera stream,
  two consumers). Request 640×480 at 15 fps, ~800 kbps, WebM (VP8/VP9, whatever `isTypeSupported` offers).
  About 6 MB per minute. That is plenty: the model runs at 320 px. **Audio off by default**, because the
  microphone hears the household; a toggle turns it on for future bark work.
- **Two ways to record**, one toggle on the Today screen:
  - *Full session*: what the toggle does when no pose model is loaded yet. Records everything in 2 min
    chunks. Usable from the very first deploy.
  - *Smart snippets*: the default once a pose model is present. Keeps 10 s snippets around useful moments
    only: a touch, attention rising or dropping, and **frames where keypoint confidence is low**, which are
    the ones worth labeling. Roughly 5–10% of a session. Full-session stays available under Advanced.
- **Sidecar metadata**, one `meta.json` per clip: app version, device and camera resolution, mount note,
  dog name, and a timeline of what the app knew: screen state, video id and tag on screen, per-frame
  keypoints with confidences (when a model is loaded), attention/arousal scores, and **touch events with
  screen coordinates**. Touches are free labels: the dog was certainly engaged, and roughly where its head
  was pointing.
- **Storage**: OPFS (falls back to IndexedDB blobs), hard cap 500 MB; when full, already-shared clips are dropped first (they exist elsewhere), then the oldest.
  Call `navigator.storage.persist()` so Chrome doesn't evict.
- **Getting clips off the phone, with no backend**: *Share* button → Web Share API with files → the Android
  share sheet (Drive, Quick Share, email). Each share is a zip of `clip.webm` + `meta.json`; *Share all new*
  bundles several. Fallback when file sharing isn't supported: save to Downloads.
- **Privacy rules**: recording is off until the owner turns it on; a red dot replaces the status pip while
  recording; every clip can be played and deleted before sharing; nothing uploads on its own, ever.
- **Other owners, later**: the zip format is the contract. A future opt-in "contribute clips" flow posts the
  same zip to a presigned bucket URL (Cloudflare R2 + a tiny Worker). Not built in v1, but keep the exporter
  behind a `ClipSink` interface (`ShareSink` now, `UploadSink` later). Contributed footage needs an explicit
  consent screen and a plain statement that clips can show people and rooms; owned, consented footage is
  also what clears the licensing problem below.

**Mac side (`ml/`)**
- `ingest.py`: unzip from `ml/inbox/` into `ml/data/raw/<dog>/<clip>/`, extract frames at 2 fps with ffmpeg
  (already installed), drop near-duplicates by perceptual hash, carry the metadata along.
- `eval_clips.py`: run the current model over a clip, write an overlay video to `ml/out/` and a summary
  (detection rate, mean nose/eye confidence, jitter). This is the honest test of the model.
- `prelabel.py`: pseudo-label frames with the current model; confident frames go straight to the training
  set, low-confidence ones go to the labeling queue.
- `labeler/`: a one-page local web tool. Shows a frame with the predicted head points, drag to correct,
  `Enter` accept, `X` no dog, `S` skip. Writes YOLO pose labels. A hundred corrected frames of Niles is an
  evening's work and will move accuracy more than any architecture change.
- `train_pose.py` mixes Dog-Pose with `ml/data/labeled/`, oversampling own footage, and always reports on a
  held-out set of own clips as well as the Dog-Pose val split.

## Design

**Any device with a browser and a front camera.** The spare phone is first, but a tablet is the better dog
screen (bigger targets, further viewing distance) and a laptop works as a TV. So: layout is responsive
from 360 px phones to laptop widths; nothing assumes a touchscreen (on a laptop, dog mode is watch plus
nose-zone games, and the owner gate also opens by holding the `O` key for 3 s); camera
position differs per device (phone: short edge; tablet: long or short edge; laptop: top center), which is
one more reason attention uses a learned neutral instead of assuming the lens is centered.

Phone is mounted **landscape** at dog eye height. Dog mode is landscape-only. Owner mode works in both
orientations, single column, because the owner will often poke at it while it's still in the stand.

### Dog-facing UI

**The rule: the dog never navigates.** There are no menus, buttons, icons, text or back actions in dog mode.
The scheduler moves between screens; the dog has two verbs, *look* and *touch*, and both always do something
pleasant and never do anything wrong. Every screen times out into another one, so there are no dead ends.

```
 REST                          WATCH                         PLAY (Bop)
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│                           │ │                           │ │                           │
│                           │ │                           │ │            ╭────╮         │
│      slow drifting        │ │     full-bleed video      │ │            │ 🟡 │ ← critter│
│      blue shapes,         │ │     no chrome at all      │ │            ╰────╯  ≥35%   │
│      screen dimmed        │ │                           │ │                    of edge│
│                           │ │            ◌ ← ripple     │ │   ◌ nose cursor           │
│                           │ │              where touched│ │                           │
│·                          │ │·                          │ │·                          │
└───────────────────────────┘ └───────────────────────────┘ └───────────────────────────┘
 dog appears → WATCH           low attention 45 s → next     hit-rate falls → WATCH
                               high-then-falling → PLAY      session limit → REST
```

`·` bottom-left is the **status pip**: a 6 px dot, dim grey = no dog seen, dim green = dog tracked,
red = recording.
It is for the owner glancing across the room. Nothing else human-readable appears in dog mode.

- **Touch in WATCH** draws a soft ripple with a quiet sound and counts as engagement. It does not change
  the channel. A dog can learn "touching is nice" in a day; "touching means next" is a menu, and dogs don't
  do menus.
- **PICK screen (off by default)**: the one place the dog chooses. Screen splits into two halves, each a
  slowly zooming still from a candidate video. Touch or nose-dwell on a half picks it; 10 s with no choice
  and the bandit picks. Turn it on only after Niles has learned the touch-target exercise in Training.

```
 PICK
┌─────────────┬─────────────┐
│             │             │
│   birds     │   forest    │   halves, never smaller; no labels on
│   (still,   │   (still,   │   screen (labels here are for you)
│   slow zoom)│   slow zoom)│
│             │             │
└─────────────┴─────────────┘
```

- **Nothing startles.** All transitions are 1.5 s crossfades. Audio ramps in over 2 s and is capped.
  No flashing, no fast full-screen luminance changes, no sudden high-pitched sounds outside of the games'
  squeak, which is short and tied to the dog's own action.
- **No error UI.** A video that fails to load is skipped silently and flagged in the library. With no
  network, dog mode falls back to games plus a bundled ambient loop over the REST animation.
- **Targets**: minimum 35% of the short edge, high contrast blue/yellow on near-black, always moving a
  little, since motion is what a dog's eye picks up. Never near the owner-gate corner.
- **The pointer is visible to the dog** (owner's call, 2026-09-21; setting *Show the pointer to the dog*, on by
  default). A 9 vmin blue ring with a yellow core, gliding between model updates. It shows where the model
  thinks the dog is pointing: nose position in front of the screen, pushed further by head turn relative to
  the learned neutral (`pointAt`). The risk noted earlier stands, that a dot which follows the head can
  become prey; watch for Niles chasing it, and turn it off if he does. With the pointer on, sensing runs at
  8–10 fps instead of 2, so expect more heat.
- **Live attention monitor** (temporary, for pre-screening; setting, on by default): top-right panel with the
  mirrored camera view, box and head keypoints, presence state, attention bar, a 45 s attention trace, arousal,
  fps and inference time. It ignores touches, so the owner gate underneath still works.
- **Owner gate**: hold the top-right corner 3 s. A thin ring fills as you hold so you know it's working,
  then a one-line sum ("7 + 5 = ?") with three big answers. Wrong answer or 10 s idle drops back to dog
  mode without a sound. The ring is the only affordance and it appears only under a held finger.

### Owner-facing UI (simplified 2026-09-21, supersedes the wireframes below where they differ)

- **Front page is a channel picker**: four big tiles (Calm, Bird TV, Games, Everything). Tapping one starts it.
  No start button, no countdown, no camera on this screen. Below: one summary line once there is data, and a
  *Share* banner when there are new training clips.
- **Tabs, all spelled out**: Watch · Train · Library · Clips · Settings.
- **Settings is five rows**: volume limit, record sessions (on), show pointer to the dog (on), attention
  monitor (on), no YouTube. Removed: dog's name, session length and rest, quiet hours, rotation threshold, nose
  calibration, pick screen, recording mode/audio/storage cap, dev mode. They run on defaults. The pointer test
  is reachable at `#pointer-test` only.
- **Recording is on by default** and sharing is one tap from the front page.
- **Sessions run until the owner exits**: no session limit, cooldown or quiet hours. Calm never schedules
  games; Games opens on a game and alternates game → one video → game.
- **Exit**: a visible *✕ hold to exit* button, top-left, held for 1.5 s; Esc on keyboards. The hidden corner
  hold and the arithmetic prompt are gone: the owner couldn't find them.
- **First run** is two screens: allow camera (says what is recorded), then how to exit and how to mount.


Four destinations in a bottom bar, nothing nested more than one level deep. Dark theme, large type,
because it gets used at arm's length on a mounted phone.

```
 TODAY (home)                         TRAIN
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ Niles watched 42 min today.  │     │  ‹   SIT   ›      reps  6    │
│ Birds held attention longest.│     │  streak 3 days               │
│ ▁▂▅▇▅▂▁▁▃▆▇▃  attention      │     │ ┌──────────┐ ┌─────────────┐ │
│                              │     │ │  ✓ good  │ │  ✗ again    │ │
│ ┌──────────────────────────┐ │     │ └──────────┘ └─────────────┘ │
│ │      ▶  START SESSION    │ │     │ ┌──────────────────────────┐ │
│ └──────────────────────────┘ │     │ │                          │ │
│ 30 min · calm mix  (change)  │     │ │         CLICK            │ │
│ ◉ Record for training  [on]  │     │ │                          │ │
│ ● camera sees a dog          │     │ └──────────────────────────┘ │
│ Clips: 4 new · 31 MB      →  │     │  [ Touch-target exercise → ] │
├──────────────────────────────┤     ├──────────────────────────────┤
│ Today   Train  Library   ⚙   │     │ Today   Train  Library   ⚙   │
└──────────────────────────────┘     └──────────────────────────────┘
 LIBRARY                              SETTINGS
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ 🔍 birds in snow             │     │ Session   30 min / 60 rest   │
│ ┌────┐ Winter feeder cam     │     │ Quiet hours   22:00–07:00    │
│ │thmb│ birds · ▇▇▇▇▁ 0.78    │     │ Volume cap    ▬▬▬▬○──        │
│ └────┘            ★   ⊘      │     │ Rotate after  45 s           │
│ ┌────┐ Redwood rain walk     │     │ ───────────────────────────  │
│ │thmb│ forest · ▇▇▇▁▁ 0.61   │     │ Nose cursor        ○ off     │
│ └────┘            ☆   ⊘      │     │ Calibrate nose     →         │
│  ...                         │     │ Pick screen        ○ off     │
│ [ + Paste a YouTube link ]   │     │ ───────────────────────────  │
├──────────────────────────────┤     │ Advanced (dev mode, fps) →   │
│ Today   Train  Library   ⚙   │     └──────────────────────────────┘
└──────────────────────────────┘
```

- **Today** answers one question, "is this working for him?", in a sentence first and a sparkline second.
  The sentence is generated from the log by template, not by a model. One primary button. The camera line
  under it is a live check so you never start a session the camera can't see.
- **Recording is one toggle and one row.** The toggle sits under Start; the row opens Clips, a plain list
  (thumbnail, date, length, size, shared ✓) with play, delete, *Share* and *Share all new*. No settings to
  understand first; quality and snippet rules live under Advanced.
- **Start session** shows a 5 s countdown ("put the phone in the stand"), then dog mode. Session presets
  are just tag weightings: *calm mix*, *bird TV*, *games heavy*, *everything*.
- **Train**: the clicker owns the bottom half of the screen because it's hit without looking. Cue cards
  swipe left/right. *Good* increments reps; that's the whole data model. The touch-target exercise drops
  into dog mode with one giant pulsing target and clicks automatically on contact.
- **Library**: search box is the TinyCLIP text search. Each row shows the one number that matters, mean
  attention. ★ pins a favorite (bandit bonus), ⊘ blocks it forever. Adding a video is paste → auto-verify
  → suggested tags pre-checked → save.
- **Settings**: one screen, safe defaults, experimental things grouped below a divider, developer things
  behind *Advanced*. Nothing here is required to get a first session running.
- **First run** is a 4-step wizard instead of a manual: allow camera → add to home screen and turn on
  screen pinning (with screenshots of the Android setting) → mount the phone and confirm the preview draws
  a dot on the dog's nose → start. Nose calibration is offered later, after the first session.
- **Tone**: plain sentences, no gamified badges for the human, no notifications. The app is for the dog;
  the owner UI should feel like a baby monitor's companion app.

### Field test 1 (2026-09-21): plush wolf on a MacBook, pointer test at three distances

What the clips showed (`ml/analyze_pointer.py`, `ml/contact_sheet.py`, `tests/replay.test.ts`):
- **Jerk came from the model changing its mind, not from smoothing.** On the toy it alternates between two
  readings of the face: the right one, and one that takes a black bead eye for the nose and puts the "eyes" up
  by the ears. Both come with ~0.96 confidence, so confidence can't separate them. Each flip threw the pointer
  across the screen. A bead-eyed plush invites this more than a real dog should, but assume it can happen.
- **Dropouts made it worse**: 18–36 per 45 s run, each one resetting the smoother so the pointer blinked and
  re-snapped.
- **Distance**: near and forearm range found the toy 95% and 72% of the time; at arm's length 11%. At 320 px
  input a toy-sized head is ~40 px. The "prime zone" is close, centered and face-on.
- **Accuracy could not be measured.** Nothing the model outputs correlated with the target (|r| < 0.2), and the
  frames show why: the toy's pose barely differed between targets. Aiming a toy by hand doesn't produce the head
  turn a dog makes, so this needs Niles, or a toy moved bodily to each spot.
- **Fix shipped**: `PointerFilter` = median of the last 5 raw points (drops 1–2 frame flips) → One Euro with
  heavier smoothing → hold the last point for 600 ms through dropouts. Yaw gain halved to 0.25. Replayed on
  the three clips: 90th-percentile frame-to-frame jump 11.6 → 4.7% of screen width (near), 6.9 → 4.6 (forearm);
  dropouts 18 → 0 and 36 → 5. Cost: roughly a quarter second more lag.
- **Not fixed**: the wrong reading when it persists for more than a couple of frames, and far-range detection.
  Candidates: run the model on a crop around the last box (2× effective resolution, same cost); label a few
  hundred front-camera frames and retrain, which is what the recorder is for.

### Open question: how does a dog "click"?

The pointer gives hover. A click needs a second, deliberate signal that a dog can learn and that doesn't fire by
accident. Candidates, in the order worth trying:

1. **Boop the glass.** Camera for hover, touchscreen for click. Already works, zero false positives, and the
   touch-target exercise teaches it. Limit: at touch range the face leaves the camera's view, so the click lands
   where the nose touches, not where the pointer was. For big targets that is the same place.
2. **Dwell.** Hold the pointer on a target (400 ms in Bop today). No training needed, but it's the Midas-touch
   problem: looking is clicking. Fine for games, wrong for anything with consequences. A shrinking ring around
   the pointer would make the countdown visible.
3. **Lean in.** A quick increase in eye/ear distance (the head surging toward the screen) while the pointer is
   on a target. Natural for a dog that wants something, measurable with the current model, no contact needed.
   Needs a per-dog threshold and real footage to tune; the recorder already logs what's needed (`ptr`, keypoints).
4. **Bark or huff** via the microphone (YAMNet-class model). Hands-free and unambiguous, but it rewards barking,
   which most owners don't want.
5. **Paw or hardware button.** A big Bluetooth/USB button on the floor is how dog "talking buttons" work and is
   the most reliable option if the screen itself isn't the target.

Recommendation: ship 1 + 2 (done), prototype 3 once there are clips of Niles approaching the screen.

## Architecture

```
src/
  app/            routes: DogMode, OwnerGate, OwnerDashboard, Training, Settings
  input/          useDogTouch, hit-testing
  sensing/        camera, poseWorker (onnxruntime-web), noseCursor, attentionScore, calibration
  content/        catalog, youtubePlayer, filePlayer, rotation
  brain/          bandit, embedder (transformers.js), similarity, scheduler (watch ↔ game ↔ rest)
  games/          Bop, Chase (canvas)
  recorder/       MediaRecorder capture, snippet rules, metadata timeline, OPFS store, ClipSink (share)
  store/          IndexedDB (sessions, events, bandit state), settings
scripts/          verify-catalog.ts, embed-catalog.ts
ml/               ingest, eval_clips, prelabel, labeler/, train_pose, export, REPORT.md, inbox/, data/, out/
public/           manifest, icons, sounds, catalog.json, models/dogpose.onnx
```

`scheduler` is the one state machine: `resting → watching → gaming → watching → resting`, driven by the
engagement score, session limits and quiet hours. Everything else is a leaf it calls.

## Build order

Steps 1–6 are the product: after them Niles can use it. 7–10 are additive, in order of value, and each can
be cut without breaking what came before.

1. **Kick off pose training first** (`ml/`, background): label rewrite to head keypoints, augmentation,
   train, export. Stub `poseWorker` with a recorded trace until it lands.
2. Scaffold, PWA manifest, fullscreen + wake lock (re-acquire on visibilitychange), owner gate, `useDogTouch`,
   camera, and the **clip recorder with Clips list and share**. It needs no model.
3. **GitHub repo + Pages deploy now**, not at the end. (As built: `npm run deploy` pushes `dist/` to the
   `gh-pages` branch, because the local `gh` token lacks the `workflow` scope. The Actions workflow is parked
   at `scripts/deploy-workflow.yml`; `gh auth refresh -s workflow` enables it.) From this point the owner can install the
   app and record Niles while the rest is built. Camera, autoplay, wake lock and install
   behavior only show up on the real phone over HTTPS, so every later step gets checked there.
4. Catalog + verify script + player (YouTube and file) with touch shield and the autoplay handling.
5. Pose worker + attention, arousal and nose zones, with a debug HUD. Smart snippets and keypoint metadata
   in the recorder. `ml/ingest.py`, `eval_clips.py`, `prelabel.py` and the labeler.
6. Scheduler + rotation + bandit + IndexedDB logging + Today screen with Start session.
7. Bop, then Chase.
8. Train tab, Library, Settings, calibration, first-run wizard.
9. Embed script + TinyCLIP similarity and Library search.
10. PICK screen. README with phone setup (install PWA, screen pinning, notifications off, mount at dog eye
    height with the camera edge nearest the dog's face, keep it on a charger and out of direct sun).

## Verification

- Unit tests (Vitest): hit-testing, engagement smoothing, bandit updates, scheduler transitions.
- `verify-catalog` passes with zero dead IDs.
- Pose model: nose and eye keypoint error reported on the Dog-Pose val split; ONNX output matches the
  PyTorch output on 10 val images; measured fps in Chrome on the Mac and, once deployed, on the phone.
- Browser run on the Mac in dev mode with a dog clip as camera: score rises when the dog faces the lens;
  swap to an empty-room clip, rotation fires within the threshold; owner gate can't be opened by random tapping.
- Recorder: record 20 s in desktop Chrome, confirm the WebM plays, the zip contains matching `meta.json`,
  `ingest.py` extracts frames from it, and the storage cap evicts oldest-first.
- Lighthouse PWA installability check.
- Only Niles can run the real acceptance test. The dashboard exists so that one evening of use produces
  data instead of impressions.

## Licensing (fine for a personal prototype, not for selling)

- Dog-Pose images come from Stanford Dogs / ImageNet: research use only. AP-10K (eye labels) is listed as
  CC BY 4.0. The no-dog negatives are COCO val2017 images (Flickr photos under mixed CC licenses).
- Ultralytics code and the weights it produces are AGPL-3.0 unless you buy their enterprise license.
- TinyCLIP is MIT.
- Before this becomes a product, retrain the pose model on footage you own (Niles plus the purchased camera
  recordings, labeled with nose/eyes/ears only) using an Apache-licensed trainer such as MMPose RTMPose.
  The app only sees an ONNX file with a fixed output shape, so that swap touches nothing else.
- Considered and rejected: `hugocornellier/dog-face-landmarks` (46 DogFLW landmarks, TFLite). It is two
  stages, 11–55 MB, CC BY-NC, and reports much worse error on dogs than cats. More landmarks than we need.

## Out of scope for v1

Native launcher/ROM, buying or hosting third-party camera footage, accounts or cloud sync, multi-dog
profiles, treat-dispenser hardware, pixel-accurate camera pointing, bark detection from the microphone
(YAMNet is the small-model candidate if motion-based arousal proves too blunt).
