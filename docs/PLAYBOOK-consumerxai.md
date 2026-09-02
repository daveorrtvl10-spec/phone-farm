# TikTok farming playbook — distilled from the consumerxai channel (Handler's founder)

_Source: 15 videos, captions pulled 2026-09-02 into ~/consumerxai/txt on the VPS.
Distilled by Claude; rules below are theirs, comments in brackets are ours._

## 1. Mental model
- Farming = many accounts × many posts × one variable at a time. One account posting
  daily gives 30 data points a month and no system. [We start with 1–2 accounts,
  but keep the test discipline.]
- Layers: infrastructure game first (device, ID, network, warm-up), then the content
  game (hook, retention, engagement). Skipping layer 1 poisons layer 2.

## 2. Device & identity
- iPhone 8–12, refurbished fine. Full factory reset first, always. No emulators.
- One phone = one Apple ID, created on the phone, never reused across phones. Skip the
  phone-number verify (enter a random US number, tap Skip). Auto-updates off, iCloud
  sync off, region US, language English, time zone = network location.
- Geo comes from the IP, not the SIM. Wi-Fi + correct IP is enough; no SIM needed.
  [Josh is US-based on a home connection: no proxy, no SIM.] If a SIM is used its geo
  must match the IP geo.
- First account on a phone: **Sign in with Apple**. Later accounts on the same phone:
  **email** (Proton/Outlook), never phone number. Never reuse credentials or recovery
  emails across devices.
- Second account on a device only after the first is healthy: **6+ posts over 500 views**.
  3 accounts per phone is comfortable, 5 is the risky ceiling.
- Abort and reset if: TikTok opens with an existing profile, country code at sign-up
  isn't +1, feed shows the wrong country/language, ads dominate, or a username/bio edit
  triggers review.

## 3. Account surface
- Username: first name + 2–3 digits. Human, niche-adjacent at most. No app names, no
  keywords, no CTAs. Never changed later.
- Profile photo: neutral, human, generated (not stock), no logo. Set once.
- Bio: one generic line. No links (impossible under 1k followers anyway), no emoji spam,
  nothing that sells. Set once. Soft positioning only after consistent 700+ views.

## 4. Warm-up (their chapters 9–12)
**Phase 0 — lurker (days 1–2).** Open TikTok 3–4×/day, 10–15 min per session. Pause on
niche content, watch through, like, rewatch some clips. 5–10 follows total, 0–1 per
session. NO posts, NO comments, NO DMs, no profile edits, no IP changes, no rage-skipping.
Fail signals: feed not in target language, niche still fully mixed after day 2, ads
dominating.

**Phase 1 — training (from day 3).** Search niche keywords by hand, open several results,
watch top performers fully, like them. ≤1 comment per session, plain ("this makes sense",
"never thought of it this way"), no questions early, no emojis. Vary search terms; keep
~80% of all activity in the one niche. Move on when the feed is ~70% niche, mostly US
creators, right language. Otherwise repeat.

**Phase 2 — health test.** Find a single-image + big-text post in the niche with ≥500k–1M
views. Recreate the IMAGE without text (Nano Banana / image model), re-apply the
**exact same text overlay and caption**, post it. Wait 24–48 h.
- ≥700 views → healthy, start your own content.
- 300–700 → inconclusive, post 1–2 more warm-up posts.
- <300 → account compromised. Reset account; if it repeats, reset the phone.
Under 300 is almost never a shadowban — it's account failure.

**Ongoing daily hygiene.** 2–3 sessions/day, 10–15 min. ≤5 comments/session, 0–1
follows/session. Post and scroll in the golden windows: **7–9am, 11am–1pm, 6–9pm
Eastern** [= 6–8, 10–12, 5–8 on our phone, UTC−5].

## 5. VSC — what is worth farming
- **Virality:** a format seen repeatedly across several small creators (<5k followers),
  with comments asking follow-ups; saves and rewatches, not likes. Ignore single viral
  posts, big-follower creators, and formats already copied by thousands (plateau).
- **Scalability:** can it be made 50×, by a VA, without taste or personality? If no to
  any, don't farm it.
- **Convertibility:** comments say "where do I get this / how do I do this / this is me".
  Not "lol", "so true", fire emojis. Want problem-aware viewers, repeatable pain points,
  curiosity loops. Views ≠ installs.

## 6. Diagnosing by view count (before changing anything)
| Views | Meaning | Fix |
|---|---|---|
| 0–200 | account failure (or hook) | check account health first |
| 200–2k | hook failure | rewrite first line / first frame |
| 2k–10k | retention/engagement failure | cut the middle, add a question |
| 10k+ | scale it | copy the format many times |
A/B one variable at a time; 3–5 posts per variant; judge after 24–48 h; never delete a
post in the first 30 minutes; 3–6 consecutive posts under 300 = account failure, not
content failure.

## 7. Scripts & slideshows (their chapter 15)
- Hook in the first line, no backstory. One idea per video. End with an implication
  (open loop / engagement bait), not a conclusion.
- Slides: 2 slides can win; sweet spot 5–7; never more than 12. 5–8 words per slide,
  large classic font, contrasting background, one message per frame.
- Emotional arc: curiosity → tension/stakes → clarity → implication. Keep it simple.
- Stories, not features. Test: does the viewer think "this is me" or "this is an ad"?
- Copy the FORMAT and the hook of what is working; never invent hooks cold.

## 8. Video-8 rule (Josh) and how we use it
The median successful account lands a performing video around post 8. So posts 1–8 are
eight distinct hook/format hypotheses in one niche, not eight variations of one idea.
By post 8 there is a signal to scale.
