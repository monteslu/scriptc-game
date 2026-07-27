# Writing games

**Develop your game for the browser.** That is the whole instruction, and it is
borrowed wholesale from
[jsgamelauncher](https://github.com/monteslu/jsgamelauncher)'s own guide, because
the contract here is the same one.

Your game uses `document`, `requestAnimationFrame`, `new Image()`, `fetch`, Web
Audio and `navigator.getGamepads()`. It gets compiled to a native binary. The
same source runs in a page.

---

## Hello square

```
examples/minimal/
  game.json      # canvas size + title
  main.ts        # the game
```

`main.ts`:

```ts
import { window, document, requestAnimationFrame } from "../../web/globals.js";

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  let x = 0;

  function frame(time: number): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    x = (x + 3) % canvas.width;
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(x, canvas.height / 2 - 20, 40, 40);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
```

`game.json`:

```json
{ "width": 480, "height": 270, "title": "minimal" }
```

Build and run:

```sh
./scripts/build.sh examples/minimal
./build/minimal
```

---

## The one import line

```ts
import { document, requestAnimationFrame } from "scriptc-game/web";
```

Everything after it is browser code. **In a browser**, that specifier is
satisfied by an import-map entry or a bundler alias pointing at a module that
re-exports the real globals:

```js
export const document = globalThis.document;
export const requestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
```

so the same file compiles native and runs in a page.

### Why not actual globals?

scriptc is a static AOT compiler with no dynamic global table.
`globalThis.document = x` is refused (`SC1090`), a bound `const` does not cross a
module boundary (`SC0001`), and an ambient `declare` has no backing value. The
compiler already canonicalizes `globalThis.process` for its *own* stdlib
globals, gated on symbol provenance. Extending that to project-supplied
globals is an upstream change, tracked on a scriptc feature branch. When it lands, this
import becomes optional and nothing else changes.

---

## `load` is where setup goes

ES module imports are hoisted, so a game's module body runs **before** the host
can open a window. A browser has the same shape from the other direction: the
page exists, then scripts run. Either way, the rule is identical to normal web
practice:

```ts
window.addEventListener("load", () => {
  // canvas, context, assets, listeners -- all of it goes here
});
```

Touching `document` at module top level works (the canvas is built on first
access) but calling *draw* methods there does not, because there is no window
yet.

---

## Assets

**The game directory is the web root.** If `public/` exists, that is the root
instead, the same rule jsgamelauncher applies.

```
examples/dodge/
  game.json
  main.ts
  public/
    player.png
    music.mp3
```

```ts
img.src = "player.png";           // -> examples/dodge/public/player.png
fetch("data/level.json");         // -> examples/dodge/public/data/level.json
img.src = "/player.png";          // leading slash = web root, same file
fetch("https://example.com/x");   // a REAL url, not a filename
```

A path with a scheme (`http://`, `https://`, `//`, `data:`, `blob:`) is treated
as a real URL. This build has no network stack, so those resolve to a `Response`
with `ok === false`; in a browser they fetch normally.

### Images

```ts
const img = new Image();
img.onload = () => { ready = true; };
img.src = "player.png";
```

`png`, `jpg`, `webp`, `bmp` and `gif` all decode (Skia sniffs the format from the
bytes). Sprite sheets need no extra machinery, since the source rect picks the
cell:

```ts
const frame = Math.floor(elapsed / 90) % 4;
ctx.drawImage(sheet, frame * 16, 0, 16, 16, x, y, size, size);
```

### Audio

The spec dance, unchanged:

```ts
const audio = new AudioContext();

fetch("music.mp3")
  .then((res) => res.arrayBuffer())
  .then((bytes) => audio.decodeAudioData(bytes))
  .then((buffer) => {
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(audio.destination);
    src.start(0);
  });
```

`mp3`, `wav`, `ogg` and `flac` decode. Sound effects are ordinary Web Audio
graphs. See `engine/sfx.ts` for oscillator-based blips, or write your own.

### Fonts

```ts
new FontFace("My Font", "url(myfont.ttf)").load().then((face) => {
  document.fonts.add(face);
});
```

Text drawn before the font resolves renders nothing, exactly as an unloaded
webfont does in a page.

---

## Input

### Keyboard

```ts
const held = new Map<string, boolean>();
window.addEventListener("keydown", (e) => { held.set(e.code, true); });
window.addEventListener("keyup", (e) => { held.set(e.code, false); });
```

`e.code` is the W3C physical-key name (`"KeyA"`, `"ArrowLeft"`, `"Space"`).
SDL scancodes are USB HID usage ids, the same basis, so they map 1:1.

The platform has no "is this key down" query, on the web or here, so a game
keeps that state itself. That is normal browser practice, not a limitation.

### Mouse

```ts
window.addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; });
window.addEventListener("mousedown", (e) => { /* e.button: 0 L, 1 M, 2 R */ });
```

### Gamepads

```ts
const pads = navigator.getGamepads();
const pad = pads[0];
if (pad !== null) {
  if (pad.buttons[0].pressed) jump();      // Standard Gamepad: 0 is the south button
  const x = pad.axes[0];                   // left stick X, -1..1
}
```

The list is **slot-indexed with holes**, as the spec requires: `getGamepads()[1]`
is the pad at index 1 regardless of what happened to index 0. Empty slots are
`null` (the dialect has no sparse arrays, and it reads the same at a call site).

The [Gamepad spec](https://w3c.github.io/gamepad/#remapping) defines the Standard
Mapping **by index and names no constants**, so if you want readable names,
declare them in your own game:

```ts
const BTN_A = 0, BTN_START = 9, BTN_DPAD_UP = 12;
```

Rumble follows the spec too:

```ts
const fx = new GamepadEffectParameters();
fx.duration = 300;
fx.strongMagnitude = 0.9;
pad.vibrationActuator.playEffect("dual-rumble", fx);
```

---

## Async behaves like the web

Anything async-**shaped** settles on a later turn, even when the underlying work
already finished. This is deliberate: real code assumes it, and a shim that
resolves synchronously breaks that code in ways that look like heisenbugs.

```ts
img.src = "player.png";
img.onload = () => { ready = true; };   // attached AFTER src: still fires
console.log(ready);                      // false -- the handler has not run yet
```

Genuinely synchronous web APIs (`ctx.fillRect`, `canvas.width`) stay synchronous.

---

## What differs from a browser

A short, honest list.

| | |
| --- | --- |
| **One import line** | Until scriptc supports project globals. Aliased away in a browser. |
| **`Math` is imported** | The static tier fences `sqrt`/`sin`/`cos`/`pow`/`PI`, so they cross to libm. Import `Math` from the same module and write `Math.sqrt` normally. |
| **No `Math.random`** | Unavailable, and deliberately not faked with a fixed seed, because a silent identical "random" sequence every run is worse than a compile error. Seed your own PRNG; `examples/dodge` has a four-line xorshift32. |
| **No DOM** | `getElementById` returns THE canvas whatever id you pass; there is nothing else to query. Same shortcut jsgamelauncher takes. |
| **No network** | `fetch` of an `http(s)://` URL returns `ok === false`. Local paths work. |
| **Some dialect fences** | `Number.toString(radix)`, `Map` iteration and a few others need the dynamic engine. `scriptc coverage <file>` reports what a file uses. See [DIALECT.md](DIALECT.md). |

---

## Build

```sh
./scripts/build.sh examples/dodge      # a game DIRECTORY
./build/dodge
```

The entry file is found by convention, mirroring jsgamelauncher: `main.ts`,
`src/main.ts`, `index.ts`, `src/index.ts`, `game.ts`, `src/game.ts`.
`index.html` is not parsed, and canvas size comes from `game.json`.

Harness knobs, for tests and screenshots, are read by the **host**, never by game
source: `SG_MAX_FRAMES`, `SG_SHOT`, `SG_SHOT_FRAME`, `SG_NO_VSYNC`,
`SG_GAME_DIR`.

---

## The optional engine

`engine/` holds conveniences. A game must be able to skip it entirely, and the
`minimal` and `bounce` examples do.

```ts
import { pickup, hit, dash, gameOver } from "../../engine/sfx.js";
pickup(audio, 0.9);
```

Everything in `engine/` is written against the same web APIs your game uses. It
imports from `web/globals.js`, not from internals.
