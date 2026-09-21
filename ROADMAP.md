# Roadmap

Where Dog OS goes after the v0.1 build. `PLAN.md` is the record of what was built and why; this file is what's next.

## The loop we want

```
dog watches ──► clips + timeline ──► better tracker ──► truer attention signal ──► better picks ──► dog watches more
     ▲                                                                                                   │
     └────────────────────────── more and better content to pick from ◄──────────────────────────────────┘
```

Every session already produces the raw material: camera clips, per-frame keypoints and confidences, the
attention score, what was on screen, touches. The work below is about closing each arrow.

## Focus, in order

### 1. Record the session, not a summary of it (done 2026-09-21)
The durable asset is the raw pair: **what the camera saw** and **what was on the screen**, in sync. Model
output is a cache that any later model can regenerate. So the app now records whole sessions (camera and
sound, 5-minute clips) and logs a screen reference with every camera frame.
- The screen half is a **stand-in**: a content id plus playback time, or the game's state (target position,
  radius, hits). From that the Mac can rebuild what was showing. The real solution is the screen's own pixels,
  which becomes possible once we host the content (or can capture the display); the timeline type reserves
  `kind: "capture"` for it, and readers must switch on `kind`.
- Known gaps in the stand-in: a YouTube ad is invisible to us (playback time just stops advancing), and a
  video that is later removed can't be rebuilt.
- Every clip also carries the model file's identity, so results can be compared across retrains.
- `ml/replay.py` renders camera and rebuilt screen side by side with the model's output drawn over both, a
  scrubbing attention trace underneath, and the sound kept. `ml/eval_clips.py` re-runs a different model over
  the same footage.
- Costs accepted for the MVP: about 6 MB a minute, a 3 GB cap on the device, more heat. Cut later, once the
  models are good enough to choose what's worth keeping.

### 2. Tracker data and training (nose + attention both depend on it)
Field test 1 showed the failure to fix: the model flips between two confident readings of a face. Confidence
doesn't flag it, but **time does**: a stable box with keypoints that jump is a flip. So:
- **Mine hard frames automatically** from every clip: keypoint jumps under a stable box, low confidence,
  dropouts that recover within a second, and frames far (in TinyCLIP space) from anything already labeled.
  Those go to the labeler first. `prelabel.py` currently queues by confidence alone.
- **Label a few hundred front-camera frames of Niles** and retrain. This is the single biggest expected gain,
  because the model has never seen this camera angle.
- **Gate every new model** on a held-out set of own frames: nose error, flip rate, dropout rate, detection rate
  by distance. `analyze_pointer.py` and `tests/replay.test.ts` already compute most of it. No deploy if it regresses.
- **Resolution at range**: run the model on a crop around the last detection (2× effective resolution, same
  cost). Detection at arm's length was 11% on the toy.

### 3. Free labels from the dog: pursuit calibration
The expensive question is "where is the dog looking?" The games answer it for free. When one bright target
moves on a dark screen and the dog follows it, the target's position *is* the label. With target position
logged (step 1), every game minute yields pairs of (head keypoints → screen position). Fit the pointer
mapping per device from those pairs instead of the hand-written geometry, and measure pointer accuracy
without asking the owner to do anything. If head pose doesn't predict target position even then, the nose
pointer should be dropped in favour of touch, and we'll know rather than guess.

The same trick gives attention labels: a head that orients within a second of a squeak or a target spawn is
attending; touches are certain positives; walking off is a certain negative. Train a small classifier over
keypoint sequences on those, to replace the hand-set geometry score.

### 4. Content selection optimized for attention
- **Attention by segment, not by video.** Long ambient videos have stretches that hold a dog and stretches that
  don't. With playback time logged, build a per-video attention curve, start playback in the good stretches,
  and stop sampling the dead ones. The current bandit only sees one mean per play.
- **Predict before playing.** Replace tag-level Thompson sampling with a contextual bandit over the TinyCLIP
  embedding (ridge regression, embedding → expected attention × calm). A new video then gets a sensible prior
  from what it looks like, instead of starting cold under its tag. At 37 videos tags are fine; at hundreds
  they aren't.
- **Per-dog, with a shared prior** once there is more than one dog.

### 5. Content availability
YouTube is a prototype crutch: ads, embed terms, videos that vanish, no access to the frames. Ways out,
cheapest first:
- **Procedural content.** Canvas scenes like the games: drifting birds, fish, falling leaves. Free, offline,
  endless, and fully instrumented, which feeds step 3. Worth testing whether dogs watch it at all before
  investing.
- **Public-domain footage**, self-hosted: US federal agencies (NPS, USFWS) publish wildlife video that is public
  domain; two of the five bundled clips already come from them.
- **Owned footage**: the original idea of buying owners' backyard and pet-camera recordings. Needs a license
  template and a way to take uploads. Because we host the files, we can embed real frames and know exactly
  what was on screen.

### 6. Data pipeline
Today: Share → zip → `ml/inbox/` → `ingest.py`, by hand, one dog. Later: opt-in upload to a bucket (the
`ClipSink` interface is ready for it), a consent screen that says plainly that clips show rooms and people,
per-dog held-out evaluation sets, dataset and model versioning, and a small report per retrain.

## Parked

- **Train tab** (clicker, cue cards, touch-target exercise). Removed from the app on 2026-09-21; the code is in
  git history before that date. If it returns, a guided program is a better fit than a bare clicker. One option
  among many: Karen Overall's Protocol for Relaxation, a day-by-day sequence of stay exercises with gradually
  harder distractions, which suits an app that can read the day's tasks aloud, time them and track progress.
  Too early to build.
- **A "click" for the dog.** Options and a recommendation are in `PLAN.md`. Depends on step 3.
- **PICK screen**, nose calibration, session limits and quiet hours: built, then removed from the UI as
  unnecessary for the MVP.
- **Licensing cleanup** before anything is sold: see `PLAN.md` → Licensing.
