# Phone Farm — status and decisions

_Last updated 2026-09-02 (end of the first build-and-prove session)._

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

## Next, in order
1. Pause-and-wait in the worker + VPS watcher that wakes Claude.
2. Factory reset + fresh account (Josh), re-register, 48-hour warm-up under
   observation.
3. Follows in doomscroll; per-account warm-up scheduler and post gate.
4. Wire UGC briefs into the post endpoint.
5. Buy SE units; second profile calibration.
