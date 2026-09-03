# Account warm-up plan (beauty niche, female beautician persona)

_Written 2026-09-02 for the fresh account @lucywalters35 on the Xs Max. Phone
local time is UTC−5. Owner of the schedule: Claude (operator)._

## Principles
- Look like a new human, then look like a beautician. Day 1 is watching; day 2
  adds taste (niche searches, a few follows, more likes).
- Jitter everything: 2–4 sessions/day, 8–20 min, start times drawn from three
  windows (08–11, 13–16, 19–23 local). Never the same minute twice.
- Watch time beats likes. Likes ramp from ~1 in 12 videos to ~1 in 5.
- 48 hours is the floor. Posting for the account is refused on the device until
  the warm-up clock expires; the content system's graduation rules decide when
  the first post actually goes out.
- Profile completed by hand on day 1 (photo, name, bio). Phone on cellular.
  Never a second account on the phone.

## Day 1 (2026-09-02, local) — DONE BY SCHEDULER, plain scrolling only
Josh's instruction: no search/follow actions today.
- ~09:xx  skimmer, 8 min, likes on, saves off
- ~14:xx  skimmer, 10 min, likes on, saves off
- ~20:xx  skimmer→casual, 12 min, likes on, saves off

## Day 2 (2026-09-03, local) — add niche seeding (build tonight, run tomorrow)
- 3–4 sessions, casual → engaged, 10–20 min, likes and saves on.
- Each session: 1–2 niche searches, watch 3–5 results through; linger on niche
  videos in the feed; 1–2 follows of creators whose video was watched fully.
- Search terms (rotate): skincare routine, esthetician, facial treatment, lash
  tech, brow lamination, beautician day in the life, salon vlog, skin prep.
- Follow budget: 5–10 total over the two days, none in the first session.

## After 48 h
- Post gate lifts. First content goes out as **drafts** reviewed by Josh; the
  content system's `warmup → active` rules govern cadence (draft-only until day
  30 per its playbook).
- Add a beauty / beautician persona and niche tag to the UGC content system
  before generating briefs for this account.

## Measured taps for the seeding steps (Xs Max, TikTok Sept 2026)
- Search icon, top-right of the For You header: **(386, 66)**.
- Follow "+" under the creator avatar: NOT yet reliable — heart.y−69 opened a
  creator profile (Xs Max) and a DM composer (XR) on 2026-09-02. Follows are OFF
  until the "+" is measured on a live video. Do not re-enable by derivation.
- Search screen (measured 2026-09-03): input top, back "<" (22,66), keyboard
  Search key (361,793), suggested terms listed below the input. Results page:
  tabs Ask/Top/Videos/Users at y≈110; two-column grid, first tile centre
  **(104, 300)**, second tile (310, 300); back "<" (22,66) returns to the search
  screen, again to the feed. `DOOMSCROLL_SEARCH_RESULT_Y=300`.
- TikTok app icon after the factory reset: Xs Max home page 2 **(64, 524)**; XR home
  page 2 **(350, 420)** (also in App Library → Social at (256, 410)). Swiping left
  past page 2 lands in the App Library, where taps hit nothing.

## Not yet built
- `warmup` block in `devices.json` pluginData: `{ "@handle": { "startedAt": ISO } }`
  + post-task refusal while `now < startedAt + 48h`.
- Search + follow steps in the doomscroll (behind a `seed` option so day-1 runs
  stay plain).
- A warm-up scheduler that books the jittered sessions from this plan.
