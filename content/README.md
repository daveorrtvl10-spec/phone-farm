# Content drop

The farm posts whatever it finds here. Nothing about how slides are made lives in
this repo, so a separate session — or a person — can fill these folders without
knowing anything about phones.

## Drop a post
    content/ready/@handle/2026-09-04-hook-01/
        01.jpg
        02.jpg
        post.json

`post.json`:
    {
      "caption": "the full caption, hashtags included",
      "destination": "publish",
      "hypothesis": "what this post is testing — hook type, slide count, ending"
    }

Rules the farm enforces before it will post: images only, 1–12 slides (the picker
grid handles no more without scrolling), caption under 2200 characters, the
account past its warm-up, its health test cleared, at most 2 posts a day, and the
clock inside a golden window.

## Then
    node --import tsx scripts/post-next.mjs --account @handle

It takes the oldest ready folder, posts it, moves the folder to
`content/posted/@handle/` with a `result.json`, and records the post in
`roster.json` so views can be read against it later.
