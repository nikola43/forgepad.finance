# 🎨 AI Fusion Images

The fusion image is the soul of a Fyuz token. Here's how the forge works.

## The pipeline

1. You name two characters and (optionally) a style.
2. The backend builds a fusion prompt — one new character blending recognizable features of both, chest-up portrait, no text or watermarks — and injects the full art direction for your chosen style.
3. A state-of-the-art image model (currently **FLUX.2 Pro**) renders the fusion in seconds.
4. The image is stored on Fyuz's own S3-compatible storage and served from our CDN — the token's image never depends on a third party staying alive.

The style actually used is saved with the token, so the board can be filtered by universe — browse only the Cyberpunk fusions, only the Ghibli ones, and so on.

## The 24+ style universes

Dragon Ball Z anime action · Cyberpunk neon · Medieval fantasy · Studio Ghibli · Pixel art / 8-bit · Film noir comic · Classic superhero comic · Renaissance oil painting · Claymation · Retro 80s synthwave · Steampunk · Wild West · Ancient mythology · Space opera · Watercolor · Graffiti / street art · Samurai / feudal Japan · Post-apocalyptic · Pop art · Gothic horror · Egyptian mythology · Cartoon Network style · Vaporwave · Baroque royal portrait · Manga black-and-white

Every style carries the Fyuz brand fingerprint reinterpreted in its own visual language: near-black backdrop, citron rim light from the left, magenta from the right, and one thin orange ring behind the head.

## Fairness & security

* Generation is **signature-gated**: each render requires a fresh, single-use wallet signature, so the paid pipeline can't be spammed anonymously.
* Generation runs as a **background job** — you get a job ID and live progress; a flaky connection can't kill your render.
* Don't like the result? **Regenerate** before you launch. The image locks in only when the token is created.
