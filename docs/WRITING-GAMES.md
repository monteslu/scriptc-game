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
ctx.drawImageRect(sheet, frame * 16, 0, 16, 16, x, y, size, size);
```

The dialect has no function overloads, so each `drawImage` arity is a separate
method: `drawImage(img, x, y)`, `drawImageScaled(img, x, y, w, h)` and
`drawImageRect(img, sx, sy, sw, sh, dx, dy, dw, dh)`. The image passed is the
`Image` itself, exactly as in a browser.

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

Rumble follows the spec too. `GamepadEffectParameters` is a **dictionary**,
so it is an object literal, not a constructor:

```ts
pad.vibrationActuator.playEffect("dual-rumble", {
  duration: 300,
  strongMagnitude: 0.9,
  weakMagnitude: 0.25,
});
```

Support is reported by `vibrationActuator.effects`, which lists the
`GamepadHapticEffectType` values the pad can play. There is no `canPlay()`
method; the spec does not define one.

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

`test/asynctest.ts` asserts this rather than trusting it, across images, fetch,
`decode()`, `FontFace.load()` and `decodeAudioData`. It exists because a promise
chain once silently never ran, and nothing caught it.

### Asset failures are reported

A missing or undecodable asset warns to the terminal, naming the path it tried:

```
[scriptc-game] image failed: player.png (not found at examples/mygame/public/player.png)
```

Attaching `onerror` or `.catch` is still up to you. The warning exists because a
rejected promise with no handler is otherwise completely silent, and that is
exactly how a broken asset path hides.

---

## 3D

Two levels, both running the same source in a browser.

**Raw WebGL2.** `canvas.getContextGL()` returns a `WebGL2RenderingContext`.
Two spellings differ from a page, both aliased away in the browser build:

```ts
const gl = canvas.getContextGL();          // getContext("webgl2")
import { TRIANGLES } from "../../web/webgl/constants.js";   // gl.TRIANGLES
```

`getContext` cannot return the union a browser returns, because the dialect
does not resolve members on a union type -- a single `getContext` would
break every 2D game in the tree. Two methods, each with a concrete type, is
the honest shape. `examples/cube` is the smallest complete case.

**threeTS-lite.** A three.js-shaped library over that context, so scene code
reads the way a three user expects:

```ts
import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { MeshLambertMaterial } from "../../three/materials/Material.js";
import { DirectionalLight } from "../../three/lights/Light.js";
import { WebGLRenderer } from "../../three/renderer/WebGLRenderer.js";

const renderer = new WebGLRenderer(canvas.getContextGL());
renderer.setSize(canvas.width, canvas.height);

const scene = new Scene();
const camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 400);
camera.position.set(0, 0, 8);

const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(0xff8844));
scene.add(mesh);
scene.add(new DirectionalLight(0xffffff, 1));

renderer.render(scene, camera);
```

Available: `Object3D`, `Scene`, `Mesh`, `InstancedMesh`, `Sprite`, `Line`,
`LineSegments`, `Points`, `PerspectiveCamera`, `OrthographicCamera`,
`Raycaster`, Box/Plane/Sphere geometries plus `BufferGeometry`,
Basic/Lambert/Standard materials, ambient/directional/point/hemisphere
lights, `Fog` and `FogExp2`, `Texture`, `DataTexture`,
`WebGLRenderTarget`, and the full math tier (`Vector2/3/4`, `Matrix3/4`,
`Quaternion`, `Euler`, `Color`, `Box3`, `Sphere`, `Plane`, `Frustum`,
`MathUtils`).

**View-frustum culling is on by default**, as in three. Objects outside the
camera's view are skipped before any per-object work, and the pixels are
identical either way. Two knobs, both matching three:

```ts
renderer.frustumCulling = false;   // whole-renderer off (benchmarks)
mesh.frustumCulled = false;        // this object is never culled
```

Turn `frustumCulled` off for anything whose drawn extent is not described by
its geometry's bounds around its own origin -- a vertex shader that displaces
geometry, or a deliberate backdrop. Otherwise it vanishes the moment its
origin leaves the view, which looks like a rendering bug.

`MathUtils` is imported as plain functions, not a namespace object:

```ts
import { clamp, lerp, damp, degToRad } from ".../three/math/MathUtils.js";
```

Models are **baked, not parsed at runtime**: `codegen/bake-mesh.js` turns
glTF/GLB/OBJ into a compact `.sgm` that `SGMLoader` reads. See
[WEBGL-AND-3D.md](WEBGL-AND-3D.md) for the format and the rationale.

Where it differs from three, and why, is documented in that same file; the
short version is that API compatibility wins over layout changes that would
be faster but would stop `mesh.position.set(...)` meaning what you expect.

Running a 3D game where no window can be mapped (CI, a benchmark, any
non-interactive shell) needs `SG_HEADLESS=1` -- see Build below.

---

## What differs from a browser

A short, honest list.

| | |
| --- | --- |
| **One import line** | Until scriptc supports project globals. Aliased away in a browser. |
| **`Math` is imported** | The static tier fences `sqrt`/`sin`/`cos`/`pow`/`PI`, so they cross to libm. Import `Math` from the same module and write `Math.sqrt` normally. |
| **No `Math.random`** | Unavailable, and deliberately not faked with a fixed seed, because a silent identical "random" sequence every run is worse than a compile error. Seed your own PRNG; `examples/dodge` has a four-line xorshift32. |
| **No DOM** | `getElementById` returns THE canvas whatever id you pass; there is nothing else to query. Same shortcut jsgamelauncher takes. |
| **One event record** | `KeyboardEvent` and `MouseEvent` are the same class, carrying both field sets. `addEventListener` has one signature (the dialect has no overloads, and function parameters are contravariant, so a mouse handler cannot satisfy a keyboard-typed parameter). Every call site stays spec-correct; what you cannot rely on is `e.clientX` being *absent* from a keydown event. |
| **`new AudioContext()` can be silent** | It never returns null, as on the web. A device that will not open reports `state === "suspended"` instead of `"running"`. |
| **No network** | `fetch` of an `http(s)://` URL returns `ok === false`. Local paths work. |
| **Some dialect fences** | `Number.toString(radix)`, `Map` iteration and a few others need the dynamic engine. `scriptc coverage <file>` reports what a file uses. See [DIALECT.md](DIALECT.md). |

---

## Build

```sh
./scripts/build.sh examples/dodge      # a game DIRECTORY
./build/dodge
```

While working on a game, `dev.sh` rebuilds and relaunches on every save:

```sh
./scripts/dev.sh examples/dodge
```

There is no hot reload to be had: scriptc compiles ahead of time, so a change
means a new binary. What this removes is the manual rebuild-relaunch cycle.
A build failure prints the compiler error and keeps watching; the previous
binary is not relaunched, so a green window always reflects current source.

The entry file is found by convention, mirroring jsgamelauncher: `main.ts`,
`src/main.ts`, `index.ts`, `src/index.ts`, `game.ts`, `src/game.ts`.
`index.html` is not parsed, and canvas size comes from `game.json`.

Harness knobs, for tests and screenshots, are read by the **host**, never by game
source: `SG_MAX_FRAMES`, `SG_SHOT`, `SG_SHOT_FRAME`, `SG_NO_VSYNC`,
`SG_GAME_DIR`, `SG_HEADLESS`, `SG_GL_DEVICE`, `SG_STATS`.

`SG_STATS=1` prints frame count, mean/min/max frame time and hitch count on
exit. Useful for a before/after on a real game rather than only on the
benchmark example.

`SG_HEADLESS=1` renders into an offscreen EGL pbuffer instead of a window,
and implies no vsync. Use it to run a 3D game where no window can be mapped
(CI, a non-interactive shell, a benchmark). Without it such a run does not
fail -- it BLOCKS in `poll()` at ~0% CPU with no output, because
`SDL_CreateWindow` succeeds and the window is simply never mapped.

`SG_GL_DEVICE=<n>` picks the EGL device by index for headless runs.
`devices[0]` is not necessarily the GPU the desktop uses: a machine with
integrated and discrete graphics may enumerate the slower one first, which
silently invalidates any benchmark comparing against a browser.

---

## The optional engine

`engine/` holds conveniences. **A game must be able to skip it entirely**, and
`examples/minimal` and `examples/dodge` do: they drive `requestAnimationFrame`
and count their own `onload` callbacks. Nothing in `web/` or `host/` imports
`engine/`.

Everything in it is written against the same web APIs your game uses, so it
runs in a browser too. There is no privileged access.

### `engine/loop.ts` -- fixed-step loop

Physics on a fixed timestep, rendering interpolated between steps, so a game
behaves identically at 60Hz and 144Hz. `examples/bounce` uses it.

```ts
import { createGameLoop, LoopOptions } from "../../engine/loop.js";

const loop = new LoopOptions();
loop.update = (dt) => { /* dt is ALWAYS the same value */ };
loop.render = (alpha) => { /* alpha 0..1 between the last two updates */ };
createGameLoop(loop);
```

Interpolating by `alpha` is what removes step-boundary stutter: keep the
previous position, and draw at `prev + (cur - prev) * alpha`.

Two clamps guard against a stall. A long pause (a breakpoint, a dragged window)
is discarded rather than replayed as hundreds of catch-up updates, which is the
spiral of death that locks a naive loop up.

### `engine/assets.ts` -- load everything, then start

```ts
import { createResourceLoader } from "../../engine/assets.js";

const loader = createResourceLoader(audio);
loader.addImage("player", "player.png");
loader.addSound("music", "music.mp3");

loader.load().then((res) => {
  const img = res.getImage("player");     // draw it directly
  startGame();
});
```

`getPercentComplete()` drives a progress bar. **A failed asset does not reject
the batch**: `load()` still settles, `failed()` names what did not arrive, and
the terminal gets a warning. A game that loses one sound should still boot, and
one bad path should never leave a loading screen spinning with no explanation.

`examples/loader` shows the whole shape, including a deliberately missing file.

### `engine/sfx.ts` -- oscillator sound effects

```ts
import { pickup, hit, dash, gameOver } from "../../engine/sfx.js";
pickup(audio, 0.9);
```
