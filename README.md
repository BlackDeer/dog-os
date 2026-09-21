# Dog OS

A screen for dogs. Calm channels and two simple games, as a PWA that runs on a
spare phone, a tablet or a laptop. First user: Niles.

**App:** https://blackdeer.github.io/dog-os/ · **What was built and why:** [PLAN.md](PLAN.md) · **What's next:** [ROADMAP.md](ROADMAP.md)

## What it does

- **Pick a channel** on the front page (Calm, Bird TV, Games, Everything) and it starts. Leave by holding the
  ✕ in the top-left corner for 1.5 s, or pressing Esc.
- **Dog mode** has no menus. The dog can look and touch; a scheduler moves between *rest*, *watch* and *play*.
  Touches ripple and make a soft sound, and never navigate.
- **Watch**: a verified catalog of YouTube embeds plus a few freely licensed clips, chosen by a Thompson-sampling
  bandit that learns which tags hold attention while the dog stays calm.
- **Sensing**, all on-device: a small dog head-pose model (ONNX, onnxruntime-web) gives nose, eyes and ears.
  Attention is head orientation relative to a learned neutral; arousal is keypoint motion; a pointer shows where
  the model thinks the dog is pointing. No cloud, no LLM, no keys.
- **Recording is on by default**: short clips (640×480 WebM + a JSON timeline of what the app knew) stay on the
  device until you share them as a zip. They feed the training loop in [`ml/`](ml/README.md).
- **Tabs**: Watch, Library (search, favorite, block, add a YouTube link), Clips, Settings (five rows).

## Phone setup

1. Open the app in Chrome → menu → **Add to Home screen**, then launch it from the icon.
2. Android Settings → Security → **App pinning** on. Recents → app icon → **Pin**. (Unpin: hold Back + Overview.)
3. Do Not Disturb on. Mount the phone landscape at dog eye height, on a charger, out of direct sun.

## Develop

```sh
npm install
npm run dev            # http://localhost:5173/dog-os/
npm test               # unit tests: touch gating, attention, zones, pose decoding, bandit, scheduler
npm run verify-catalog # checks every catalog entry against YouTube oEmbed / HEAD
npm run embed-catalog  # TinyCLIP thumbnail embeddings → public/catalog.json
npm run build
```

Dev mode (Settings → Advanced) adds a HUD and lets a video file stand in for the camera, so the whole loop can be
tested at a desk with a recorded clip.

## Privacy

Camera frames are processed in the browser. Recording is on by default and can be turned off in Settings; a red dot
shows while it runs, every clip can be reviewed and deleted, and nothing leaves the device unless you press Share.
`ml/inbox`, `ml/data` and `ml/out` are gitignored so footage of a home is never committed.

## Licensing caveats

Fine for a personal prototype, not for selling: the pose model is trained on Dog-Pose (Stanford Dogs / ImageNet images,
research use), AP-10K and COCO negatives, with Ultralytics (AGPL-3.0). Accuracy and caveats: [ml/REPORT.md](ml/REPORT.md). Covering the YouTube player breaks YouTube's embed terms.
See PLAN.md → Licensing for the path out (own footage, Apache-licensed trainer, self-hosted content). Bundled clips
are public domain or CC BY; credits are listed in Library → Credits.
