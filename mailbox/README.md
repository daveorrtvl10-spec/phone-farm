# Machine-readable mailbox

Needed only for the **second and third** account on a phone. The first account on
each phone uses Sign in with Apple and needs no mailbox at all — see
`docs/SCALING-TO-20.md`.

## One-time setup (Josh)
1. Add a spare domain to Cloudflare (any cheap one; it never has to serve a site).
2. Email → Email Routing → enable, then add a **catch-all** route.
3. Deploy `email-worker.js` and point the catch-all at it. Bind the existing R2
   bucket as `MAIL` in `wrangler.toml`.

## Then
Each account gets its own address, e.g. `lucy0412@thatdomain`, used once. TikTok
sends the code, the worker writes `mail/<address>/<timestamp>.json` into R2 with
the code already extracted, and the creation run reads it with the R2 keys that
are already on the VPS (`~/.config/r2.env`).

## Why not a normal inbox
A personal Proton/Outlook inbox would work but means handing over credentials to a
mailbox that holds other things. This route only ever exposes mail sent to
throwaway addresses on a throwaway domain.
