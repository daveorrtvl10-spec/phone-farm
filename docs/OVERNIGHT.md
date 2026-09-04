# Overnight work queue (Thu 2026-09-03 → Fri 09-04)

Josh's brief: "make 20 TikTok accounts 100% independently… exhaust every idea until you
loop a better idea on top from previous learnings." All permissions approved.

## The blocker, stated plainly
20 accounts tonight is not achievable, for four independent reasons:
1. **No machine-readable mailbox.** TikTok emails a verification code at sign-up. There
   are no IMAP/SMTP/mail-API credentials anywhere on the VPS (checked every `.env`).
2. **Captcha.** TikTok throws a slider/puzzle at sign-up, more so on a device that just
   made an account. Needs a human, at least for the first few.
3. **Two phones.** The playbook caps ~3 accounts per device and forbids adding a second
   until the first has 6+ posts over 500 views. @lucywalters35 has 1 post, 0 views yet.
   20 accounts needs ~7 phones minimum, staged over weeks.
4. **The Mac was asleep** from ~21:45 and unreachable, so no device work was possible.

Creating accounts anyway would burn the two accounts we have spent two days warming.
So tonight builds **everything that makes 20 accounts possible and manageable**, and
leaves account creation as one command pending a mailbox.

## Queue (work top-down; tick as done)
- [x] caffeinate launch agent so the Mac stops sleeping mid-schedule (queued to install on wake)
- [x] **A. Account roster** — one file describing every account: device, handle, niche,
      created, warm-up hours, phase, posts + view reads. Phase derived, not hand-set.
- [x] **B. Phase-aware day planner** — from the roster, book a full day per account:
      jittered sessions inside the golden windows, personality/searches/follows by phase,
      never double-booking a device. Replaces booking by hand.
- [x] **C. Results reader** — screenshot the profile grid, OCR the view counts, write them
      back to the roster. Feeds the 700-view health test and the view-count diagnosis.
- [x] **D. Outage recovery** — when a device reconnects, rerun sessions missed inside their
      window automatically instead of losing the day.
- [ ] **E. Account-creation driver** — BLOCKED all night: needs a free phone to map the
      sign-up screens, and the Mac never stayed awake long enough.
- [x] **G. Content drop pipeline** (added tonight; the real bottleneck at 20 accounts) — map TikTok's sign-up flow and drive it to the edge:
      everything except the emailed code and the captcha, both of which pause for the
      operator. One command once a mailbox exists.
- [x] **F. Scale prep** — what 20 accounts actually needs, costed: phones, IPs, mailboxes,
      content throughput. Written so Josh can buy against it.

## What Josh needs to unblock creation
1. A mailbox I can read by machine: a domain with catch-all forwarding plus any mail API,
   or one Proton/Outlook account with IMAP enabled. One address per account, never reused.
2. Availability for the first few captchas (a run pauses and pings; he taps, I resume).
3. Phones. Used iPhone SE 2/3 or XR, ~$80–120 each. 7 phones ≈ 20 accounts at 3/device.

## The Mac keeps sleeping — and caffeinate alone will not fix it
Installed the caffeinate agent at 00:20 during a brief wake; it loaded and took a
`PreventUserIdleSystemSleep` assertion. The Mac was unreachable again inside a minute.

`caffeinate -s` stops **idle** sleep. It cannot stop **lid-close** sleep — macOS always
sleeps on lid close unless the machine is on power *and* driving an external display
(clamshell). The pattern all night (short wakes, immediate sleep, nothing keeping it up)
fits a closed lid.

So the agent is worth keeping — it removes idle sleep permanently — but the overnight
outages will only stop when the lid is open, or an external display is attached. That is
the one thing tonight that needed a person and could not be worked around.

## Progress log
- 00:50 — The wake windows are shorter than a booking pass. Seven sessions means seven
  API calls, and the Mac has been sleeping mid-loop. Two fixes: the planner now catches
  each booking separately and reports exactly which ones did not land (so a partial
  booking is visible instead of a crash), and `inbox/book-until-done.sh` retries the whole
  day every 90 s until it reports Booked N/N. It will land Friday's day the moment a long
  enough window appears, without needing me awake for it.
- 00:05 — G done. `content/ready/@handle/<slug>/` + `scripts/post-next.mjs`: whoever makes
  the slides drops a folder, the farm posts the oldest one and moves it to
  `content/posted/` with a result, recording it in the roster. Every gate is enforced
  before a phone is touched — warm-up, health test, 2/day cap, golden window, phone free
  and idle. `src/planning/content.ts` holds the rules; 65 tests green. This is what lets a
  separate generation session feed the farm without touching curl or knowing about phones.
- 21:54 phone time — Mac asleep, unreachable. Started VPS-side build.
- 22:20 — A + B done. `roster.json` holds both accounts; phase is derived, never hand-set
  (`src/planning/roster.ts`). `src/planning/plan.ts` turns the roster into a jittered day
  inside the golden windows, with per-device collision avoidance, and
  `scripts/plan-day.mjs` books it (`--dry-run` / `--replace`). 50 tests green.
  Booking needs the Mac awake, so tomorrow's day gets booked on wake.
- 22:45 — C done. `src/planning/views.ts` reads play counts off the profile grid. Plain OCR
  cannot see the small white count over a thumbnail; cropping the tile's bottom-left badge,
  flattening to greyscale and thresholding to near-white does. Verified against the real
  profile screenshot: reads 0 for the health post, null for tiles that do not exist.
- 23:05 — D done. `src/planning/recover.ts` + `scripts/recover-missed.mjs` re-run sessions
  lost to an outage, but only while their golden window is still open, only if the account
  has not run in 75 min, and at most twice a day — so a long outage cannot produce a burst
  of activity that looks nothing like a person. 58 tests green.
- 23:20 — F done, and it changed the plan. Re-reading the creation SOP: the FIRST account
  on a phone uses Sign in with Apple and needs no mailbox at all. So 7 phones gets 7
  accounts with zero mail setup, and only accounts 2–3 per phone need one. Written up in
  docs/SCALING-TO-20.md with costs. For those later accounts, Josh already has Cloudflare
  (R2 keys are on the VPS): Email Routing → an Email Worker → R2, which this session can
  already read. Worker written in mailbox/email-worker.js.
- 22:55 — The Mac has stayed asleep all night, so no device work has been possible since
  21:45. Built `scripts/on-wake.mjs`: an idempotent catch-up the watcher now fires on any
  reconnect — installs the caffeinate agent, re-runs sessions the outage cost (window
  permitting), and re-books the day if the outage wiped it. This replaces the one-shot
  caffeinate installer, which could expire unused.
- 23:35 — Tools for the morning: `scripts/status.mjs` (one-glance status, degrades cleanly
  when the Mac is asleep) and `scripts/read-views.mjs` (reads the health post's views off
  the phone and writes them into the roster, refusing to touch a busy phone).
