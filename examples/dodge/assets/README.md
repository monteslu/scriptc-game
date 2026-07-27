# dodge assets

Everything here is committed, so the example runs from a fresh clone.

| file | what |
| --- | --- |
| `player.png` | 32x32 ship, drawn facing up |
| `hazard.png` | 32x32 spiked mine |
| `coin.png` | 64x16 strip: four 16px frames of a spin |
| `music.mp3` | background track, looped at half volume |
| `make-sprites.mjs` | the generator that produced the three PNGs |

The sprites are committed **alongside their generator**, so the art is
reviewable as code and regenerable if the palette changes. Regenerate with:

```
node examples/dodge/assets/make-sprites.mjs
```

(`package.json` here exists only so Node resolves `@napi-rs/canvas` from the
copy already installed for the conformance goldens : Node resolves imports
from the importing *file's* directory, not the cwd.)

## Loading

Images are plain files decoded at startup : no bundling, no packing step:

```ts
const img = decodeImage(readFileSync("examples/dodge/assets/player.png"));
ctx.drawImageScaled(img, x, y, w, h);
```

Skia sniffs the format from the bytes, so **png, jpg, webp, bmp and gif** all
work (`test/imagetest.ts` proves each one). Audio is the same shape:
**mp3, wav, ogg and flac** via `decodeAudioFile` (`test/decodetest.ts`).

A sprite sheet needs no extra machinery : `drawImageRect` picks the cell:

```ts
const frame = Math.floor(elapsedMs / 90) % 4;
ctx.drawImageRect(coin, frame * 16, 0, 16, 16, x, y, size, size);
```
