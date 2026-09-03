# Test account spend log (@leor.towe2)

| date | item | model | est. cost | file |
|---|---|---|---|---|
| 2026-09-02 | profile photo v1 | gpt-image-1 1024² medium | $0.06 | inbox/leor/profile-v1.png |

## Day 1 — 2026-09-02 (both accounts, lurker phase)
| account | phone | sessions | videos | likes | saves | follows | notes |
|---|---|---|---|---|---|---|---|
| @lucywalters35 | Xs Max | 4 booked, 3 clean + 1 partial | 406 | 49 | 1 | 1 | 07:21 failed (zero-budget bug, rerun 07:27); 19:38 run left the feed after a follow tap → stopped by hand |
| @leor.towe2 | XR | 3 booked, 1 clean + 1 partial | ~300 | ~25 | 0 | 0 | 10:33 cut short by a worker restart (my error); 19:05 missed (phone unplugged); 19:40 run ended in a DM composer after a follow tap → stopped by hand, nothing sent |
Fixes shipped tonight: on-feed guard every 6 swipes + after navigating taps; live screen watch; Home+lock at session end; ±20% length jitter. Follows disabled until the "+" is measured on a live video.
Warm-up clocks: lucy 28h 52m left (opens Fri 2026-09-04 ~04:30 device time), leor 32h 24m left.
| 2026-09-03 | lucy health-test slide (bg, 1 refused + 1 ok) | gpt-image-1 1024×1536 medium | $0.12 | inbox/lucy-health-post.jpg |

## @lucywalters35 — health-test post (Thu 2026-09-03, 18:51 device time)
- **Published publicly.** Copied the hook text and caption of a skincare post with 161.8K likes
  (found via the Photos tab of a "skincare tips" search). Image regenerated as a 2x2 skincare
  collage (the original's subject was refused by the image model), exact overlay text and caption
  re-applied per the playbook.
- TikTok auto-attached a sound ("pov — Ariana Gr…"). Not chosen by us; harmless for the test.
- **Read views at 24 h (Fri ~18:51) and 48 h (Sat ~18:51).**
  ≥700 → healthy, Josh's content starts. 300–700 → one more warm-up post. <300 → account compromised.
- Posted by hand over the tunnel, not by the scheduler: the run hit three first-time blockers on the
  factory-reset phone (WDA Photos permission, TikTok camera + microphone permissions) and then a real
  bug — see below.

### Bug found: picker grid is top-anchored when the library is small
`chooseRecentMedia` assumes the Recents grid is scrolled to the bottom and taps `cellY≈735`. With only
two photos in the library there is a single row at the **top** (centre y≈208), so the tap landed on
empty space and the run sat on the picker tapping Next. Fix: compute the row from `assetCount`
(3 columns, 138 pt rows) and anchor to the top when the grid fits without scrolling.
