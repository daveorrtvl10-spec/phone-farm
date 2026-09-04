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
- [ ] **C. Results reader** — screenshot the profile grid, OCR the view counts, write them
      back to the roster. Feeds the 700-view health test and the view-count diagnosis.
- [ ] **D. Outage recovery** — when a device reconnects, rerun sessions missed inside their
      window automatically instead of losing the day.
- [ ] **E. Account-creation driver** — map TikTok's sign-up flow and drive it to the edge:
      everything except the emailed code and the captcha, both of which pause for the
      operator. One command once a mailbox exists.
- [ ] **F. Scale prep** — what 20 accounts actually needs, costed: phones, IPs, mailboxes,
      content throughput. Written so Josh can buy against it.

## What Josh needs to unblock creation
1. A mailbox I can read by machine: a domain with catch-all forwarding plus any mail API,
   or one Proton/Outlook account with IMAP enabled. One address per account, never reused.
2. Availability for the first few captchas (a run pauses and pings; he taps, I resume).
3. Phones. Used iPhone SE 2/3 or XR, ~$80–120 each. 7 phones ≈ 20 accounts at 3/device.

## Progress log
- 21:54 phone time — Mac asleep, unreachable. Started VPS-side build.
- 22:20 — A + B done. `roster.json` holds both accounts; phase is derived, never hand-set
  (`src/planning/roster.ts`). `src/planning/plan.ts` turns the roster into a jittered day
  inside the golden windows, with per-device collision avoidance, and
  `scripts/plan-day.mjs` books it (`--dry-run` / `--replace`). 50 tests green.
  Booking needs the Mac awake, so tomorrow's day gets booked on wake.
