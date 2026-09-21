# Research: what we know about dogs, screens and technology

Preliminary, gathered 2026-09-21 by research agents that were only allowed to cite sources they opened.
Three files sit behind this summary:

- [`canine-science.md`](canine-science.md): established science. Vision, hearing, attention, learning, welfare, individual differences. 66 sources, mostly peer-reviewed.
- [`dogs-and-technology.md`](dogs-and-technology.md): 2015–2026 work on dogs and tech. Talking buttons, dog-initiated video calls, touchscreens, TV viewing, pet cameras, computer vision, and what parrots and monkeys do with media. Tiered A (peer-reviewed) and B (convincing but less authoritative).
- [`attention-stimuli-notes.md`](attention-stimuli-notes.md): which on-screen stimuli attract dogs, ranked by strength of evidence, and why nothing is universal. [`opener-candidates.json`](opener-candidates.json): 30 verified videos chosen to match, with start offsets and an arousal-risk rating; all are now in the catalog and 22 of them lead sessions as "openers".

Numbers in brackets refer to `canine-science.md`.

## The short version

1. **Dogs do watch screens, in glances.** Untrained dogs look at images and video, recognise other dogs on
   video, and track moving objects with anticipation [10–14]. But looks last seconds (18 s was the longest in
   one study), half of dogs watch in 1–5 minute bouts [20], shelter dogs looked 10.8% of the time and lost
   interest within days [19]. Plan for glances and fast habituation, not viewing sessions.
2. **What pulls them: other dogs, other animals, movement, then sound.** Humans rank 9th of 17 content types
   [20]. Dog vocalizations reliably turn heads. Doorbells and cars set off fearful dogs.
3. **The typical reaction is excitement, not calm.** 78% approach the screen, 76% vocalise [20]. The authors
   of the largest survey caution against assuming video suits dogs left alone. The one DogTV trial found no
   cortisol effect.
4. **Nothing suggests dogs can learn to scroll.** No study shows a dog learning a next/back or any two-action
   media control, or using a screen without food rewards. When dogs were given control of a TV, their behaviour
   didn't change; in DogPhone 34 of 35 calls were accidents. Touchscreen work succeeds, in labs, with feeders,
   on 15-inch screens with 2–3.5 inch targets, after a median of 15 weekly sessions. Video is a weak
   reinforcer; food is what every working paradigm runs on.
5. **What dogs do well: one deliberate action for something they want.** Buttons for "outside" and "play",
   nose-touches, tug sensors, learned in minutes to weeks. And dogs visibly enjoy outcomes their own action
   caused, and get frustrated by the same outcome arriving on its own [47].
6. **Individuals differ more than breeds.** Breed explains ~9% of behavioural variance [63]. Age matters:
   attention peaks mid-life, seniors orient slower and engage less [65, 66].

## The doom-scroll question

The honest reading: **the app choosing for the dog, from the dog's attention, is the design the evidence
supports. A dog operating the feed is unsupported, though not disproven.** Nobody has tried it properly.

If we try, the literature says how. One action, not two ("something else", never "back"). A big, forgiving
physical target: an external button beats on-screen controls, because dogs don't naturally nose vertical
glass, can't hold back impulsive touches, and look at one point while touching another. Shape it with treats,
then fade them, which is exactly what worked for parrots (treats only in training, then 147 self-initiated
calls). Expect a novelty spike and then decay; measure the plateau, not the first week. Parrots kept going
because the content was a live social partner. The nearest equivalent for a dog is probably another dog, or
the owner.

## What this changes in Dog OS

**Already right**
- Blue and yellow for anything the dog must see [1–3].
- Rewarding *attention × calm* rather than attention alone. The literature's main welfare worry is arousal.
- Audio that ramps in under a volume cap. A third of dogs are noise-sensitive, and sudden high-pitched
  intermittent sounds are the worst kind [34, 35].
- Learning per dog rather than per breed.
- Treating camera output as head orientation, not gaze or emotion. There is no validated consumer-camera
  attention model, and automated facial action-unit detection is poor (F1 0.18–0.35).

**Should change**
- **Bring back a session cap and an arousal check**, off by default if need be but present. We removed session
  limits as MVP clutter; the evidence says excitement is the common reaction and recommends supervision.
- **Variety is a feature, not a nicety.** A fixed music playlist stops calming kennelled dogs within a week,
  possibly two days; varying it preserves the effect [31, 32]. The catalog needs to be large and the picker
  needs a novelty term, not just a preference term. Expect attention to any one video to fade over days.
- **Size matters more than we assumed.** Dog acuity is about a third of ours and brightness discrimination
  about half [4, 5]. Detail on a phone at a metre is mush. Tablets and TVs are the natural screens; on a phone,
  only big, high-contrast, moving things will register. Touch targets should be 2–3.5 inches: on a phone
  that means one target, full stop.
- **Prefer 90/120 Hz devices when there's a choice.** Dogs' flicker fusion is higher than ours and dog labs
  now use 120 Hz. Whether a 60 Hz phone panel actually flickers to a dog has never been tested.
- **Leave out doorbells, knocking, cars and alarm-like sounds**, and treat squirrel-at-feeder content as
  high-arousal by default.
- **Let games end in a catch.** No dog study exists on uncatchable on-screen prey, but the cat laser-pointer
  data and the hunting-sequence argument make frustration plausible [58]. Bop already lets the dog "get" the
  critter; keep it that way, and keep the success cue paying out every time [46].

**Worth testing, cheap**
- **The owner as content.** An owner's face on video has measurable reward value, and dogs follow a projected
  owner's cues about as well as the real one when the image is life-size and the owner greets them first
  [16, 38]. A few short owner-recorded greeting clips could be the strongest "channel" we have. Recorded voice
  through a small speaker is understood far worse than live speech, so expect it to work as a face, not as
  commands.
- **Plain animated shapes that chase each other.** Dogs tell chasing from random motion in simple on-screen
  geometry [42]. Procedural content may need less realism than we'd guess.
- **A freeze or rewind as an attention grabber**: it worked the first time in an eye-tracking study, and only
  the first time [10].

**A caution for the nose pointer.** Dogs track on-screen motion with their *eyes*, smoothly and with
anticipation [10]. On a small screen they may never need to move their head, in which case head pose carries no
pointing signal at all, however good the model. The pursuit-calibration experiment in `ROADMAP.md` will show
this directly: if head pose doesn't follow a moving target, that's the screen-size effect, and the pointer
belongs on tablets and TVs, not phones.

**Signals a camera could read later**, from work that coded them by hand: frustration shows as blinking, lips
parting, jaw drop, nose licks and flattened ears; positive anticipation as ears drawn toward the midline; stress
as yawning, lip licking, panting, lowered posture, turning away, shake-offs [51–53]. Automated detection of
these is weak today and single-breed. Useful as labels for our own footage, not as a product claim.

## Gaps we could fill ourselves

Nobody has published: how long pet dogs actually watch at home, measured rather than owner-estimated; whether
attention to a video decays over days and how fast; whether any content keeps a dog calm *and* attending;
whether a dog will sustain a single "something else" action without food; whether a consumer front camera can
tell attending from not. Dog OS records exactly the data these need.
