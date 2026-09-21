# Dogs interacting with technology, 2015–2026

Verified source notes, gathered 2026-09-21. Every source was opened during the research session (publisher
pages, Europe PMC / OpenAlex abstracts and full text, open-access PDFs, university press releases).
**Tier A** = peer-reviewed or conference papers and lab preprints. **Tier B** = journalism, press releases,
company material: less authoritative, sometimes convincing. "[snippet]" = seen only in a search result.
What this means for the app is in `README.md`.

## 1. Talking-button dogs

**Solid.** Button-trained dogs respond appropriately to a few high-value words ("play", "outside") whoever
presses, with blinded experimenters, so it isn't Clever Hans. Across a large population, dogs' presses are not
random and not copies of their owners'. **Suggestive.** "Meaningful" two-button combinations, a population
statistic, not per-dog comprehension. **Hype.** Syntax, abstract concepts, "I love you": production has never
been tested under controlled conditions. **Counter-evidence.** The button hardware degrades audio so badly that
cue-following drops to ~30%. Every UCSD paper has FluentPet/CleverPet-affiliated authors and uses the company's
app data; critics note "spontaneous" pressing takes months of training.

**For us:** dogs will operate a physical button unprompted for outcomes they care about (outside, food, play).
The payoff is a real-world reinforcer, not media.

- **A.** Bastos et al. (2024). How do soundboard-trained dogs respond to human button presses? *PLOS ONE* 19:e0307189. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0307189. n = 30 in person + 29 citizen-science. ~7× more appropriate behaviour for play and outside words, for owner or stranger, button or speech; nothing conclusive for food words. Tests comprehension of 3 word types, not production. Six authors consulted for FluentPet, two are employees.
- **A.** Bastos et al. (2024). Soundboard-trained dogs produce non-accidental, non-random and non-imitative two-button combinations. *Sci Rep* 14:28771. https://www.nature.com/articles/s41598-024-79517-6. 194,901 presses by 152 dogs over 21 months, owner-logged in the FluentPet app; 29% multi-button. "The issue of reference is beyond the scope." The paper's above-chance pairs differ from those in the press release; check before quoting.
- **A, counter.** Higaki et al. (2025). Sound quality impacts dogs' ability to recognize playback words. *Sci Rep* 15:14175. https://www.nature.com/articles/s41598-025-96824-8. n = 17. Success ~100% live speech, ~70% loudspeaker, ~30% buttons.
- **A, critique.** Włodarczyk et al. (2024). Talking Dogs: the paradoxes of soundboard use. *Animals* 14:3272. https://www.mdpi.com/2076-2615/14/22/3272. Presses "are typically incoherent and require interpretation"; months of training.
- **A, commentary [snippet].** Kuhlmeier (2026). *Learn Behav* 54:181–182. https://link.springer.com/article/10.3758/s13420-025-00679-y. Data support non-random pressing but not intention to communicate.
- **B.** Jarry, McGill Office for Science and Society. https://www.mcgill.ca/oss/article/technology-did-you-know-general-science/dogs-speak-breakthrough-or-illusion. Summarizes the conflicts of interest and social-media editing bias.
- **B.** Hazel & Fernandez (2023), The Conversation. https://theconversation.com/do-dog-talking-buttons-actually-work-does-my-dog-understand-me-heres-what-the-science-says-219807. Operant conditioning and owner cueing explain most of it.

## 2. Animal–Computer Interaction with dogs

**Solid.** Dogs reliably operate purpose-built physical inputs on cue, for food: nose and paw buttons, bite and
tug sensors, nose-touch sequences on large touchscreens. Trained working dogs learn them in minutes.
**Weak.** Pet dogs deliberately operating *media*: every such study has n = 1–2 and uses an implicit trigger
(proximity, body tracking, moving a ball), not a learned action. In DogPhone, 34 of 35 final-phase calls were
coded accidental. In DoggyVision, giving the dogs control changed nothing measurable. **Not found.** Any dog
using a two-action media controller.

- **A.** Hirskyj-Douglas, Piitulainen & Lucero (2021). Forming the Dog Internet: a dog-to-human video call device. *PACM HCI* 5(ISS):494. https://doi.org/10.1145/3488539 · PDF https://eprints.gla.ac.uk/258964/1/258964.pdf. n = 1 (the author's Labrador), 16 days over ~3 months; ball with accelerometer launches a call. "Almost all (34/35) calls were coded as being made by accident… but we do not know a dog's thoughts." Owner anxiety when the dog didn't answer.
- **A.** Hirskyj-Douglas & Read (2018). DoggyVision. *Anim Behav Cogn* 5:388–405. https://www.animalbehaviorandcognition.org/article.php?id=1160. n = 2. Dogs attended to the screen but "did not appear… to change their activation behaviors" when given control.
- **A.** Hirskyj-Douglas, Nioche & Sukys (2024). An immersive screen interface for dogs to control screens at home. *ACI '24*. https://doi.org/10.1145/3702336.3702342 [abstract]. n = 1, 6 months. Watched some videos longer after triggering; "no significant preference for particular media features or content".
- **A.** Hirskyj-Douglas, Read & Cassidy (2017). A dog-centred analysis of dogs' interactions with TV media. *IJHCS*. https://doi.org/10.1016/j.ijhcs.2016.05.007. n = 2, 3 screens, 20 s clips. Watched 212 of 320 s and 96 of 340 s; longest single look 18.1 s, at a dog in a field; much time attending to no screen.
- **A.** Jackson et al. (2015). FIDO: wearable communication interfaces for working dogs. *Pers Ubiquit Comput* 19(1). https://link.springer.com/article/10.1007/s00779-014-0817-9. n = 8 trained dogs; sensors activated reliably on command after minutes of training. On handler cue and rewarded, not self-initiated.
- **A.** Zeagler et al. (2014, 2016). Touchscreen interfaces for working dogs. *UIST '14* https://doi.org/10.1145/2642918.2647364 · *ACI '16* https://doi.org/10.1145/2995257.2995384 [abstracts]. Nose touch needs different handling: lift-off selection, sliding, large targets.
- **B.** CBS News (2016), the FIDO Project. https://www.cbsnews.com/news/the-fido-project-training-dogs-to-be-lifesavers/. Dogs tap coloured dots in sequence to send an alert.
- **B.** Open University (2025), the Dogosophy Button (Mancini's ACI lab). https://www.open.ac.uk/blogs/news/science-mct/ou-launches-wireless-button-allowing-dogs-to-control-household-appliances/. A blue, convex, textured pad with a confirmation light, designed around canine colour vision and nose/paw ergonomics. No reliability data published.
- **A, methods.** Hirskyj-Douglas & Webber (2021). Novelty effect and habituation in ACI. *ACI '21*. https://doi.org/10.1145/3493842.3493893. "Animals' initial responses to a technological intervention are followed by lower levels of usage as the product ceases to be new."

## 3. Dogs and TV at home

**Solid, owner-reported.** Most dogs in responding households react to screens; animal content, above all other
dogs, plus motion and sound (barks, doorbells) drive it; reactions are mostly *excited*, not calm; younger dogs
and sporting/herding breeds engage more. **Solid, observed.** Attention is brief and intermittent: looks of
seconds, 18 s at most in one study; shelter dogs looked 10.8% of the time and habituated within days.
**Suggestive.** Dogs recognise dogs on video; an owner's face on video has reward value; video evokes
physiological responses. **Hype.** DogTV-style stress-reduction claims: the one trial found no cortisol effect.

- **A.** Donohue et al. (2024), Mowat lab survey. *Appl Anim Behav Sci* 270:106151. https://doi.org/10.1016/j.applanim.2023.106151. See `canine-science.md` #20. Humans ranked 9th of 17 content categories; cartoons engaged >10% of dogs.
- **A.** Montgomery, Krichbaum & Katz (2025). *Sci Rep* 15:20274. https://doi.org/10.1038/s41598-025-06580-y. 453 owners; owner-estimated mean viewing 14 min 8 s; ~45% always respond to dog vocalizations; excitable dogs follow on-screen objects, fearful dogs react to doorbells and cars.
- **A.** Graham, Wells & Hepper (2005). See `canine-science.md` #19.
- **A.** Epstein et al. (2021). DOGTV via PetChatz in shelters. *Appl Anim Behav Sci* 236:105215. https://doi.org/10.1016/j.applanim.2021.105215 [citation verified, results snippet]. No cortisol difference; less time at the back of the kennel. Authors and funding tied to the products; read the COI statement before citing.
- **A.** Mongillo et al. (2021). Dogs recognize dogs from videos. *Anim Cogn* 24:969–979. https://doi.org/10.1007/s10071-021-01470-y. n = 32.
- **A.** Bolló et al. (2021). The implicit reward value of the owner's face for dogs. *iScience*. https://doi.org/10.1016/j.isci.2021.102763. n = 39; dogs chose the container paired with video of the owner's face, with equal food in both.
- **A.** Matsushita, Nagasawa & Kikusui (2022). Autonomic responses to human–dog interaction videos. *PLOS ONE* 17:e0257788. https://doi.org/10.1371/journal.pone.0257788.

## 4. Touchscreens and tablet games

**Solid.** Dogs learn two-choice visual discriminations on a touchscreen and transfer to new stimuli. **Also
solid: what it costs.** Step-wise shaping, a lab rig, a feeder, and food on every correct trial. A 2026
systematic review found only 14 dog touchscreen studies and names lengthy training, food dependence, the
ergonomics of a nose on a vertical screen, and impulsive touching as the barriers. **Not found.** Any study of
dogs using a screen with no food reward.

- **A.** Yang-Fu et al. (2026). On the (limited) use of touchscreen-based research with dogs. *Anim Cogn* 29:48. https://doi.org/10.1007/s10071-026-02055-3 [full text]. "Touchscreen-based studies rely primarily on food as the reinforcer." Dogs "are not naturally inclined to interact with vertical, two-dimensional surfaces using their noses"; they struggle to withhold impulsive touches; **the offset between eyes and nose tip means the attended point differs from the touched point**; low refresh rates may shimmer.
- **A.** Wallis et al. (2017). See `canine-science.md` #24 for the apparatus and training numbers (full text read there).
- **A.** Müller et al. (2015). See `canine-science.md` #40.
- **A.** Kenawell et al. (2026). Four-button computerized game. https://doi.org/10.3758/s13420-025-00692-1. n = 1, 66 sessions, ~21 h over 11 months. Authors call for testing "whether dogs voluntarily engage with the system in the absence of external rewards."
- **A.** Zamansky et al. (2017). Is my dog "playing" tablet games? *CHI PLAY '17*. https://doi.org/10.1145/3116595.3116634. About half of respondents did not consider it play; aware of "potential dangers". Baskin & Zamansky (2015), *CHI PLAY '15*, https://doi.org/10.1145/2793107.2810315: "the nature of animal-computer play interactions is far from being understood."
- **A, cats.** Payne, Kleinberger & Hirskyj-Douglas (2025). Look What the Cat Tapped In. *ACI 2025*. https://doi.org/10.1145/3768539.3768541. 16 cats, 5 months, a tablet video app; enjoyment equal to toys, humans felt less connected.
- **A, framework.** Cunha & Renguette (2022). Training animals to use touchscreens. *ACI '22*. https://doi.org/10.1145/3565995.3566044. Habituation → shaping → discrimination.
- **B.** CleverPet Hub (product). Food-dispensing console with 3 touchpads. No independent study found.

## 5. Pet cameras, feeders, launchers

No peer-reviewed or independent study of Furbo, Petcube, iFetch or similar was found, on welfare, separation
problems, or dogs operating them alone. Marketing only. Adjacent science: contingent remote reinforcement can
shape alone-time behaviour, slowly; dogs respond far worse to recorded cues than live ones; dogs will work for
food but don't prefer to; UK owners are sceptical of tech that replaces human–dog interaction.

- **A.** Feuerbacher & Muir (2020). Owner return as a reinforcer for separation problems. *Animals* 10:1110. https://doi.org/10.3390/ani10071110. n = 5; all improved, but after 4 sessions only one could stay alone >5 min.
- **A.** Rothkoff et al. (2024). See `canine-science.md` #48.
- **A.** Heys, Lloyd & Westgarth (2024). 'Bowls are boring'. *Vet Rec* 194:e3169. https://doi.org/10.1002/vetr.3169. n = 1,750 owners; perceived benefits only.
- **A, preprint.** van der Linden et al. (2022). Technology in human–dog relationships. https://arxiv.org/abs/2202.02030. n = 155 UK owners, negative about tech mediating play, walks, training; remote-interaction pet tech called "the nightmare scenario".

## 6. Computer vision for dog behaviour

**Solid.** General quadruped keypoint models work zero-shot (SuperAnimal). A 46-landmark dog face dataset
exists (DogFLW). In a lab, a deep model separated frustration from positive anticipation at 89%.
**Caveats.** One breed, controlled lab, two induced states; landmark-based approach reached 0.76; automated
DogFACS action-unit detection is poor (F1 ~0.18–0.35); authors flag breed and in-the-wild generalisation as
unsolved. **Gap.** No validated webcam model of "is the dog looking at the screen". For us: head orientation
toward the camera is feasible; emotion labels from a phone camera would go beyond the evidence.

- **A.** Boneh-Shitrit et al. (2022). Explainable recognition of emotional states from canine faces. *Sci Rep* 12:22611. https://doi.org/10.1038/s41598-022-27079-w. n = 29 Labradors.
- **A.** Martvel et al. (2025). Dog facial landmarks detection. *Sci Rep* 15:21886. https://doi.org/10.1038/s41598-025-07040-3 · dataset https://github.com/martvelge/DogFLW.
- **A.** Ye et al. (2024). SuperAnimal pretrained pose models. *Nat Commun*. https://doi.org/10.1038/s41467-024-48792-2. 45+ species, 10–100× more data-efficient when fine-tuned.
- **A.** Martin et al. (2024). Depth-sensing tail-wag interpretation. *ACI '24*. https://doi.org/10.1145/3702336.3702340 [citation only].

## 7. Other species controlling media

Parrots are the best existence proof. They learned a two-step request (ring a bell, touch a photo) with treats
**only during training**, then made 147 deliberate calls in two months, formed partner preferences, and engaged
more with live than recorded video. But a caregiver mediated every call. Zoo sakis triggered media by walking
into sensor zones; most interactions lasted seconds, use followed a novelty bell curve, and the authors could not
separate preference from habituation. **Takeaway:** animals exercise control when the input is trivial and the
content is socially meaningful; "preference" read off trigger counts is weak data; usage decays.

- **A.** Kleinberger et al. (2023). Birds of a Feather Video-Flock Together. *CHI '23*. https://doi.org/10.1145/3544548.3581166. 18 parrots, 3 months.
- **A.** Hirskyj-Douglas, Cunha & Kleinberger (2024). Parrot engagement in live vs pre-recorded video calls. *CHI '24*. https://doi.org/10.1145/3613904.3641938. 9 parrots, 6 months; initiated 65/108 live vs 40/108 recorded; 561 vs 142 min. "Treats were provided only during the initial-training phase."
- **A.** Hirskyj-Douglas & Kankaanpää (2021). White-faced sakis and visual enrichment. *Animals* 11:557. https://doi.org/10.3390/ani11020557. 7 sakis; "engagement bell curve suggesting confounding factors of novelty and habituation".
- **A.** Hirskyj-Douglas & Kankaanpää (2022). Do monkeys want audio or visual stimuli? *DIS '22*. https://doi.org/10.1145/3532106.3533577. Audio triggered ~2× more; interactions "mostly short, lasting only a few seconds"; not statistically conclusive.
- **A.** Piitulainen & Hirskyj-Douglas (2020). Music for Monkeys. *Animals* 10:1768. https://doi.org/10.3390/ani10101768.

## Looked for and not verified

- A dog learning a next/previous or any two-action media interface; sustained screen use without food. **Nothing found, either way.**
- Independent studies of Furbo, Petcube, iFetch, the CleverPet Hub; independent evidence that DogTV reduces stress.
- A validated webcam model of a dog attending to a screen (a Hirskyj-Douglas & Read paper reportedly claims >82% for face/gaze tracking of dogs watching TV; could not be opened).
- Quantitative touchscreen results from the FIDO papers; usage numbers for the ACI '24 immersive screen.
- A dog-specific study of compulsive or problematic screen use (the laser-pointer association is from cats).
