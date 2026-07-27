# Canvas 2D coverage matrix

Tiers from [docs/API-SURFACE.md](../docs/API-SURFACE.md): **S** shipped and
conformance-tested, **D** deferred (path known), **X** intentionally out.

Every S row names the scene that proves it. Scenes live in `test/scenes.ts`
(ours) and `test/golden/scenes.mjs` (the reference), and are compared
pixel-for-pixel by `./scripts/conformance.sh`. 55/55 byte-identical as of
the Phase 2 close.

## State and transforms

| API | Tier | Scene |
| --- | --- | --- |
| `save` / `restore` (incl. style state) | S | save-restore |
| `translate` | S | transform-translate |
| `rotate` | S | transform-rotate |
| `scale` | S | transform-scale |
| `transform` | S | transform-matrix |
| `setTransform` | S | transform-settransform |
| `resetTransform` | S | (used by every transform scene) |
| `getTransform` | S | latched via sg_canvas_latch_transform; no scene (returns data, draws nothing) |
| `reset` | D | |

## Rects

| API | Tier | Scene |
| --- | --- | --- |
| `fillRect` | S | fill-rect, and most scenes |
| `strokeRect` | S | stroke-rect |
| `clearRect` | S | clear-rect |

## Paths

| API | Tier | Scene |
| --- | --- | --- |
| `beginPath` / `closePath` | S | path-close |
| `moveTo` / `lineTo` | S | path-lines |
| `bezierCurveTo` | S | path-bezier |
| `quadraticCurveTo` | S | path-quadratic |
| `arc` | S | path-arc, path-arc-anticlockwise |
| `ellipse` | S | path-ellipse |
| `arcTo` | S | path-arcto |
| `rect` | S | path-rect |
| `roundRect` | S | path-roundrect |
| `fill("nonzero")` | S | fill-rule-nonzero |
| `fill("evenodd")` | S | fill-rule-evenodd |
| `stroke` | S | path-lines and every stroke scene |
| `clip` | S | clip-rect, clip-path |
| `isPointInPath` / `isPointInStroke` | S | no scene (predicates, draw nothing) |
| `Path2D` class | D | |

## Styles

| API | Tier | Scene |
| --- | --- | --- |
| `fillStyle` / `strokeStyle` (CSS colours) | S | color-formats |
| `createLinearGradient` | S | gradient-linear, gradient-stops |
| `createRadialGradient` | S | gradient-radial |
| `createConicGradient` | S | gradient-conic |
| `createPattern` | S | pattern-repeat, pattern-no-repeat |
| `lineWidth` | S | line-width |
| `lineCap` | S | line-cap |
| `lineJoin` | S | line-join |
| `miterLimit` | S | miter-limit |
| `setLineDash` / `getLineDash` | S | line-dash |
| `lineDashOffset` | S | line-dash-offset |
| `globalAlpha` | S | global-alpha, fill-alpha, image-alpha |
| `globalCompositeOperation` | S | composite-multiply/screen/xor/lighter |
| `imageSmoothingEnabled` | S | image-smoothing-off |
| `filter` (CSS filter string) | D | |
| `shadow*` | D | |

## Text

| API | Tier | Scene |
| --- | --- | --- |
| `fillText` | S | text-fill, text-sizes |
| `strokeText` | S | text-stroke |
| `measureText` | S | verified against the reference exactly (114.2699966430664 for the 24px sample); returns data, so no scene |
| `font` shorthand parsing | S | text-weight-style, text-sizes |
| `textAlign` | S | text-align |
| `textBaseline` | S | text-baseline |
| font registration | S | all text scenes (three DejaVu faces) |
| `direction` / `letterSpacing` / `wordSpacing` | D | |

## Images

| API | Tier | Scene |
| --- | --- | --- |
| image decode (png/jpeg/webp/gif) | S | every image scene (png); other codecs untested |
| `drawImage` 3-arg | S | image-draw |
| `drawImage` 5-arg | S | image-scaled |
| `drawImage` 9-arg | S | image-subrect |
| offscreen canvas as a source | S | offscreen-canvas |
| `putImageData` | S | put-image-data |
| `getImageData` | S | test/readbackprobe.ts (values asserted; a golden compare cannot see readback) |
| `createImageData` | D | callers build their own Buffer today |
| PNG save | S | used by the harness itself for all 55 scenes |

## Intentionally out

| API | Why |
| --- | --- |
| `drawFocusIfNeeded`, hit regions | DOM concepts |
| `ImageBitmap`, `OffscreenCanvas` transfer | no workers; `createCanvas` covers offscreen composition |
| `toDataURL` | no consumer for base64 URLs; `saveImage(path)` instead |
| DOMMatrix class | `getTransform` returns a `{a,b,c,d,e,f}` record; the class is dialect cost with no game value |
