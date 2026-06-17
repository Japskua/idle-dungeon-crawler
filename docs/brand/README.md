# Brand assets — Idle Dungeon Crawler

Hand-authored pixel art, built the same way as the game itself: a fixed palette
(`content/palette.json`) + a pixel font + the game's real sprites, emitted as
crisp, scalable SVG. Open `gallery.html` locally to preview all four together.

| File | Use | Native px | Renders at |
|------|-----|-----------|-----------|
| `logo.svg` | wordmark / site header | 160×44 | 1280×352 |
| `box-art.svg` | game "box cover" (portrait) | 150×192 | 750×960 |
| `blog-cover.svg` | blog post cover (≈1.9:1) | 240×126 | 1200×630 |
| `project-cover.svg` | project page cover (≈1.9:1) | 240×126 | 1200×630 |

They're SVG, so they scale to any size with no quality loss and stay tiny.
`image-rendering: pixelated` keeps the pixels sharp if you up-scale in CSS.

Need PNG/JPG (some social-card slots require raster)? Convert with e.g.
`rsvg-convert -w 1200 blog-cover.svg > blog-cover.png` or any SVG→PNG tool.
