# Shreya Gundagani — The Portfolio Issue

A fashion-magazine portfolio built around one object: a black string bag.
The bag hangs in a lit studio in front of the masthead; inside it are four
magazines (the "issues") and a few props. Click the bag and everything comes
out; pick an issue and it opens as a real 3D magazine you can page through.

Built with **Vite + Three.js + TypeScript** — no framework, every piece of the
3D hand-made.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build → dist/
npm run preview  # serve the production build
```

## What's on screen

| Piece | Where | Notes |
| --- | --- | --- |
| The net bag | `src/scene/netbag.ts` | Physically simulated: every knot is a Verlet particle, every cord a tension-only constraint, with long-range tethers so it never stretches. The base ring is tucked under a satin pouch that swings as a pendulum from the handle loop. Drag it to swing it. The net wraps whatever is inside and relaxes when you empty it. Shape matched to the reference photo side by side (tall trapezoid, rounded base, black satin pouch). |
| Satin pouch | `src/scene/satin.ts` | Procedural geometry with an anisotropic satin material, gathered at the drawstring; matte underneath. |
| Magazines (closed) | `src/scene/magazineModel.ts` | Thin perfect-bound magazines with glossy covers, printed spines and page edges; they flex (vertex bend). |
| Cover photography | `src/art/shoots.ts`, `src/scene/studio.ts` | Each cover photo is a real render of a 3D still life (the bag, a lipstick, a lens, a wax-sealed envelope), shot offscreen and composited like a real cover. |
| Covers, pages | `src/art/covers.ts`, `src/art/pages.ts` | Drawn on canvas: masthead, cover lines, barcode; inside pages with running heads, folios, drop caps, pull quotes and an inventory flat-lay with numbered callouts. |
| The reader | `src/scene/magazine.ts`, `src/reader/` | Pages curl as they turn (vertex shader); exact print colours (custom paper shader); single-page panning on phones; pinch / ctrl-scroll / button zoom with panning so every page is readable on a phone. |
| Colourways | `src/theme.ts` | Two editions: **Bordeaux** (butter / black, burgundy accents) and **Teal** (slate teal / cacao). The swatch control re-styles the CSS, the bag and re-shoots the covers. |
| Studio, HUD, cursor | `src/scene/environment.ts`, `src/ui/*` | Transparent WebGL canvas over a CSS backdrop; the masthead sits *behind* the 3D so the bag overlaps it like a cover star. |

## Editing the content

All copy lives in two places:

- `src/config.ts` — name, links, the four issues (cover lines, teasers), and the prop captions.
- `src/art/pages.ts` — the inside pages (brands, credentials, the Cartier story, contact).

The facts in the copy come only from the original brief: her roles, the four clients and
what she did for each, the Cartier "Through the Lens of India" finalist entry, the
post-grad in Luxury Fashion Brand Management and the CS degree. Nothing else is claimed
(no metrics, no results, no NDA). The witty asides are written in her voice, so give them a
quick read with Shreya before launch.

To publish an email or phone number, set `IDENTITY.email` / `IDENTITY.phone` in
`src/config.ts`; the contact issue adds them automatically (including a mailto button).

## Dropping in real photography

The covers and pages are designed around render "photos" and typographic plates, so
real images can replace them without changing the layout:

- **Brand campaign imagery** — `brandPlate()` in `src/art/pages.ts` draws a typographic
  plate for each client. Load an `HTMLImageElement` and draw it with the `photo()`
  helper into the same rectangle (keep the client label on top).
- **Cartier entry** — page 1 of `issueCartier()` uses the lens render full-bleed; swap
  `k.photos.cartier` for the entry image.
- **Portrait** — add it to the feature opener in `issueBag()` (page 2) with `photo()`.

Put image files in `public/` (they're served from `/`). Wait for `img.decode()` before
drawing (pages are drawn on demand when an issue is opened).

## Deploy

The site is fully static: `npm run build` writes everything to `dist/` (an `index.html`,
one JS file, one CSS file and `og.jpg`). Any static host works.

- **Vercel** (configured in `vercel.json`: framework vite, output `dist`, long-cache
  headers for hashed assets): import the repo in the Vercel dashboard, or run
  `npx vercel` in this folder.
- **Netlify / Cloudflare Pages**: build command `npm run build`, publish directory `dist`
  (or drag the `dist/` folder onto Netlify Drop).

After the domain is live, change the `og:image` / `twitter:image` URLs in `index.html`
to absolute URLs (link previews need them).

## Dev tools

- `/dev/bagtest.html` — the bag alone with orbit controls (`T.view(...)`, `T.covers()`).
- `/dev/devices.html` — the site in phone and tablet iframes.
- In dev, `window.app` exposes the app (`app.step(n)` advances frames deterministically).
- `/dev/bagtest.html` uses the site's own in-bag layout and colliders, so it's the place to
  compare the bag against a reference photo: `tests/e2e/bag-render.mjs` renders it on the
  photo's backdrop, and `python dev/silhouette.py photo.png render.png overlay.png` compares
  the two outlines numerically (height/width ratio, width at every height) and draws them
  on top of each other.

Respects `prefers-reduced-motion`; without WebGL the accessible text version is shown.

## Browser notes

- Canvas `letterSpacing` (used for all the printed tracking) gets a kerning-preserving
  fallback in browsers without it (older Safari) — see `src/art/canvas.ts`.
- `color-mix()` declarations all have plain fallbacks; the cover studio drops to 8-bit
  render targets where float targets aren't renderable.
- Printed canvases are released once uploaded to the GPU (iOS Safari caps canvas memory);
  if the WebGL context is lost the page reloads cleanly.
- iPhone: everything pinned to an edge respects the safe areas (notch, Dynamic Island,
  home indicator); the stage and reader take all gestures (`touch-action: none`), and
  controls don't double-tap-zoom.
- Input is self-healing: a pointer whose `pointerup` never arrives can't leave the reader
  captured or the bag held, and a cancelled touch (the system taking the gesture) never
  counts as a tap.
- Without Web Audio the Sound toggle is simply not shown.

## Performance

Measured in Chrome on an integrated AMD Radeon (1920×1080): about 144 fps while reading,
and no main-thread task longer than about 0.1 s once the page is ready. The heavy work is
kept off the interactive path:

- Studio photography (cover photos, the Issue 01 flat-lay) is built one prop per task,
  textures are uploaded ahead of the shot, and pixels come back through an async
  read-back (GPU fence), so no frame waits on it. The flat-lay is shot in idle time
  after load, and again after a colourway switch.
- Studio materials are kept (only geometry and textures are released), so shaders
  compile once instead of on every shot.
- Paper grain is a composited noise tile, not a per-pixel loop.
- The net's pouch collision uses a precomputed table, and its rest drape is settled
  once.

## End-to-end tests

`tests/e2e/` drives the production build in real browsers with real input (mouse,
keyboard, touch, multi-touch pinch): Chromium, WebKit (Safari's engine) and Firefox, on
desktop, iPhone 13, iPad and Pixel 7 profiles. Each run opens the bag, reads all four
issues cover to back (keys, clicks, drags, wheel, swipes, taps), zooms and pans, uses
"next issue", interrupts a pick mid-flight, switches colourway (and checks it survives a
reload), runs the keyboard-only path, resizes / rotates while reading, checks that nothing
invisible can catch a click, and fails on any console error or warning. GPU memory is
logged to catch leaks. Screenshots land in `tests/e2e/shots/`.

```bash
npm run build && npm run preview -- --host 127.0.0.1 --port 4173   # terminal 1
cd tests/e2e && npm install && npx playwright install chromium webkit firefox
node e2e.mjs webkit-iphone13 webkit-desktop chromium-desktop       # or no args for all
```

Also in `tests/e2e/`: `monkey.mjs` (seeded random taps, drags, keys, wheel, buttons,
colourway switches and resizes, with state invariants checked after every action and a
normal visit required to still work afterwards) and `a11y.mjs` (an axe-core WCAG 2.1 AA
audit of the hero, open, caption and reader states, desktop and phone).

`tests/e2e/studio-race.mjs` is a focused regression test for the studio's async read-back
(a synchronous shot taken while an async one is pending must not come back blank).

With `?e2e` in the URL the production page exposes `window.app` (the tests only read from
it, via `inspect()` and `pickAt()`); without it nothing is exposed.

Playwright's WebKit build for Windows can't apply variable-font weights, so its screenshots
show a lighter masthead than real Safari (macOS/iOS), which renders the intended heavy
Bodoni like Chrome and Firefox do.

## Reader controls

Drag, swipe, scroll or ← → to turn · tap the left/right of a page · pinch, ctrl/trackpad
scroll, the magnifier button or `+`/`-`/`0` to zoom (drag pans while zoomed) · Esc closes.
