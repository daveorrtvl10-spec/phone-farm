# Phone Farm — status and decisions

_Last updated 2026-09-04 (overnight). Front door: run `node --import tsx scripts/status.mjs`._

## What this is
A fork of Handler's open-source iPhone farm, adapted to Josh's iPhone Xs Max and
to the current (Sept 2026) TikTok app. Purpose: the real-device posting and
warm-up layer for the UGC slideshow content system. Josh's fork:
`daveorrtvl10-spec/phone-farm`, main branch.

## Where we are
**Proven.** Single-image and 3-slide TikTok drafts run end to end by automation
on the Xs Max (iOS 18.7.9, UDID `00008020-000164…0C42002E`): four consecutive
automated slideshow drafts, captions typed, drafts verified in TikTok. Both
TikTok form layouts and both camera layouts handled.

**Running.** The Mac runs five launchd agents (`mac/launchd/`): appium,
wda-service, worker, web, and a reverse-SSH tunnel to the VPS. They start at
login, restart on crash, and the tunnel reconnects by itself. Logs: `logs/`.

**Operated by Claude from the VPS** (see `mac/RUNBOOK.md` §7): dashboard API on
`127.0.0.1:3000` and SSH to the Mac on `127.0.0.1:2222` through the tunnel.
Claude pulls, restarts the worker, submits posts, screenshots, taps, and reads
run logs without Josh.

## 2026-09-04 — driving by element, and the off-feed cause found

**The off-feed drift had a specific cause, and it is fixed.** Slideshow handling
swiped a blind 2-6 slides regardless of how long the post was. One swipe past the
last slide opens the creator's profile, and the run then watched and engaged there
for minutes. A live two-minute session landed on a creator profile three times
this way. It is the behaviour Josh saw, and the most bot-like thing the farm did.

The slide count is now read off the screen (`src/tiktok/slide-dots.ts`), because
TikTok exposes no page indicator in the accessibility hierarchy at any snapshot
depth the feed survives. The current dot is drawn far brighter than the rest, which
gives both the number of slides and the position. When the dots cannot be read the
run stays put rather than swiping blind.

Verified live: a five-minute, 33-video session with **zero** off-feed events, and a
two-slide post correctly left alone at its last slide.

**Blockers are handled by label now, not by guessed coordinates.** Modal alerts go
through WDA's native alert API; full-screen and in-feed overlays are found in the
view hierarchy and pressed by element id. Anything matching no known-safe dismissal
is left for a human instead of guessed at, and nothing destructive is ever pressed.
Proven live by clearing an Amazon promo overlay off the feed.

**Measured limits worth keeping (they cost a day to learn):**

| snapshot depth | cost on the feed | what it exposes |
| --- | --- | --- |
| 8 | ~1.3s | tab bar only |
| 16 | ~4.3s | top nav and in-feed promo close buttons |
| 24 | — | kills the WDA process |

The first snapshot on the feed can take **67 seconds**; every call after it is
sub-second. Scripts that gave up early looked exactly like a crashed WDA and took
the device offline, which is what several earlier "crashes" actually were.

## What was done tonight (in order)
1. Fork, Mac runbook, launchd agents, env template. Found the upstream install
   is broken (Appium 3 with an Appium-2 driver); pinned Appium 2.19.
2. Built an `iphoneXsMax` coordinate profile (upstream only had iPhone 8/SE),
   first derived from geometry, then every point measured on the device.
3. Fixed like/save detection (profile-relative gap), single-tap like (double-tap
   was un-liking), OCR handle matching (edit distance + zoomed header read).
4. Mapped the whole post flow by hand over the tunnel and rewrote it around
   screen signatures instead of blind taps: picker (oldest-first, opens at the
   bottom), preview, editor, form (two layouts), inline vs full-screen caption
   editor, Drafts/Post verified by the form disappearing.
5. Handled the interstitials TikTok throws at a fresh account: "Swipe up for
   more", contacts prompt, avatar promo, passkey sheet, header tooltips, and
   the camera's two layouts. Every run now cold-starts TikTok.
6. Raised the media cap from 3 to 12 slides.

## Decisions
- **Claude is the operator**, not a model call inside the worker. The scheduler
  runs the happy path; Claude steps in live for anything new, fixes it by hand,
  then encodes it. (Josh, 2026-09-02.)
- **When automation fails twice for different reasons, stop patching and drive
  the flow by hand three times, then encode.** (Josh, 2026-09-02.)
- **Next build: pause-and-wait.** A run that cannot classify a screen holds the
  session, raises an assist request, and waits for the operator; a watcher on
  the VPS wakes Claude. Runs must not fail silently when TikTok changes.
- **Factory-reset the Xs Max and start a fresh account** once pause-and-wait
  exists. The current test account (@danieuam4s5) was churned through many
  prompts and is retired. Reset checklist: re-pair with Xcode, Developer Mode,
  `npm run wda:prepare` from Terminal.app, install TikTok + sign in + full photo
  access, no passcode, re-run Register device. The UDID, profile, and
  calibration overrides survive the erase.
- **Warm-up is 48 hours per new account:** doomscroll only, posting refused on
  the device side, sessions ramp skimmer → casual → engaged. The content
  system's graduation rules decide when real posting starts after that.

## Known gaps
- No pause-and-wait yet: an unrecognised screen fails the run; Claude sees it on
  the next look and reruns.
- No follows/comments/searches in doomscroll; no per-account state or warm-up
  gate yet.
- One phone, one measured profile. A second model needs its own calibration
  pass; iPhone SE 2/3 units are the recommended farm phones (upstream profile).
- Picker grid math covers 12 visible cells; more needs grid scrolling.
- The contacts prompt recurs unless TikTok → Settings → Privacy → Sync contacts
  is off; the passkey sheet recurs because the phone has no passcode (dismissed
  automatically).

## Added overnight 2026-09-03/04
- `roster.json` + `src/planning/roster.ts` — every account's device, niche, warm-up and
  posts. **Phase is derived** (lurker → training → health-test → posting → blocked) from
  age and the health post's views, so it cannot drift from reality.
- `src/planning/plan.ts` + `scripts/plan-day.mjs` — books a full jittered day per account
  inside the golden windows, never overlapping two accounts on one phone.
- `src/planning/views.ts` + `scripts/read-views.mjs` — reads play counts off the profile
  grid (thresholded badge crops; plain OCR cannot see white text on a thumbnail).
- `src/planning/recover.ts` + `scripts/recover-missed.mjs` — re-runs sessions lost to an
  outage, inside their window only, capped so a long outage cannot cause a burst. The
  watcher calls it automatically when a phone reconnects.
- `scripts/nightly.mjs` — the whole nightly routine as one command.
- `scripts/status.mjs` — one-glance status; works even with the Mac asleep.
- `mac/launchd/com.phonefarm.caffeinate.plist` — stops the Mac sleeping mid-schedule.
- `docs/SCALING-TO-20.md` — what 20 accounts really needs. Key finding: the first account
  on each phone signs in with Apple and needs **no mailbox**; only accounts 2–3 per phone
  need one, and Cloudflare Email Routing → Worker → R2 covers that with existing keys.

## Next, in order
1. Pause-and-wait in the worker + VPS watcher that wakes Claude.
2. Factory reset + fresh account (Josh), re-register, 48-hour warm-up under
   observation.
3. Follows in doomscroll; per-account warm-up scheduler and post gate.
4. Wire UGC briefs into the post endpoint.
5. Buy SE units; second profile calibration.

## Scaling plan (discussed 2026-09-02)
- Unit of scale = the phone. Accounts on one phone are serialized by the playbook's
  health bar (2nd account only after 6+ posts over 500 views); phones run in parallel.
  Ceiling ~3 accounts/phone. Five phones ≈ 5 → 10 → 15 accounts over ~6 weeks.
- Human steps per account (~20 min): fresh Apple ID on the phone, sign-up, one-time
  photo + bio. Everything else is automated or Claude-driven.
- Real cost line is content: 15 accounts × 1–2 posts/day = 20–30 slideshows/day.
- **IP/data:** many phones on one home IP get linked. Decide per-phone IPs (SIM or
  mobile proxy) before phone #3.
- **No-laptop host:** WDA needs Xcode only to sign/build (yearly on the paid team).
  Launching it over USB works from Linux via go-ios; Appium/scheduler/dashboard are
  plain Node. Target: headless Linux box or Mac mini + powered USB hub, same tunnel.
- Build order: prove the two live accounts → phase-aware scheduler + account roster +
  results reader → migrate host to a headless box before phone #3 → per-phone IPs.
