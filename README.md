# scriptc-game

**Write a browser game. Compile it to a NATIVE binary.**
**No chromium, No Electron, No node.js, No bun, No JIT, No V8**


A game here is ordinary web code: `document.getElementById`, `getContext("2d")`,
`requestAnimationFrame`, `new Image()`, `fetch`, Web Audio, `navigator.getGamepads()`.
It compiles ahead of time into one self-contained executable, with Skia, SDL2 and
the webaudio-node C++ graph statically linked behind a C-ABI shim.

```ts
import { window, document, requestAnimationFrame } from "scriptc-game/web";

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  let x = 0;

  function frame(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    x = (x + 3) % canvas.width;
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(x, canvas.height / 2 - 20, 40, 40);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
```

That is the whole game. `./scripts/build.sh examples/minimal` turns it into a
binary; in a browser, the one import line is satisfied by an import-map entry or
a bundler alias and the same file runs in a page.

## Why this shape

[jsgamelauncher](https://github.com/monteslu/jsgamelauncher) proved the model on
Node: *just develop your game for the browser*, and a compatibility layer runs it
without one. This project takes the same contract to an **ahead-of-time native
compiler**: the game directory is the web root, browser APIs are the API, and
the output is a single binary instead of a 120MB embedded runtime.

The trade is deliberate: existing web games do not drop in unmodified (the
static tier fences some dynamic JS), but new games get a dramatically better
deployment shape and run the same source in a browser.

## Layout

| Tier | Rule |
| --- | --- |
| `web/` | Browser API shims: Canvas 2D, Web Audio, Gamepad, `globals.ts`. **Games see only this.** |
| `engine/` | Opinionated conveniences: fixed-step loop, asset loader, sound effects. Optional, and a game must be able to skip it entirely. |
| `host/` | The FFI wall, frame loop, handle tables, mailbox, ABI tables, URL resolution. Games never touch it. |
| `shim/` | The C/C++ side: SDL window, Skia wrappers, audio thread, decoders. |

`web/` follows the specs. Where our implementation deviates, the deviation is
commented at the site with a reason. Constants the web does *not* define
(the Standard Gamepad has no `BTN_A`, only `buttons[0]`) are deliberately not
invented here.

## Assets

The game directory is the web root, with `public/` preferred when present. That
is the same rule jsgamelauncher uses. `fetch("data/level.json")` and `img.src = "player.png"`
resolve against it, while `http://`, `https://`, `//`, `data:` and `blob:` are
real URLs rather than filenames.

## Features

| Area | What works |
| --- | --- |
| **Canvas 2D** | Paths, both fill rules, transforms, gradients, patterns, line dash, all 26 composite operations, clipping, text with `FontFace`, images, offscreen canvases, `putImageData` / `getImageData` |
| **Images** | `new Image()` with `onload`; png, jpg, webp, bmp, gif; sprite sheets via the source rect |
| **Audio** | Web Audio graph with 15 node types, `AudioParam` scheduling, `decodeAudioData` for mp3 / wav / ogg / flac, plus a live SDL device |
| **Input** | `keydown` / `keyup` with W3C `code` names, mouse events, `navigator.getGamepads()` with the Standard Mapping, hot-plug, and rumble |
| **Loop** | Real `requestAnimationFrame` (a queue, not a single slot), `load` event, genuinely async asset loading |
| **Engine** (optional) | Fixed-step loop with interpolation, and an asset loader with progress. Pure web API underneath; skippable |
| **Build** | One command from a game directory to a self-contained native binary |

Not yet: WebGL and 3D, a cross-compile matrix, and CI.

### Verified

Every number below comes from `./scripts/test.sh`, which runs headless.

| Suite | Result |
| --- | --- |
| Canvas conformance | **55/55** scenes byte-identical to `@napi-rs/canvas` goldens |
| Input | **89/89** checks, including a synthetic gamepad for the hardware-free lane |
| Audio graph | **16/16** checks |
| Audio decoders | **17/17** checks across mp3, wav, ogg and flac |
| Image formats | **20/20** checks across png, jpg, webp, bmp and gif |
| Sprite sheets | **10/10** checks |
| Async ordering | **26/26** checks that async-shaped APIs settle on a later turn |
| Pixel readback | passing |

`./scripts/build.sh examples/dodge` builds the reference game: sprites, looping
music, sound effects, and gamepad input with rumble. `examples/loader` is the
same stack driven through the optional engine, with a loading screen.

## Building

Three things are needed that this repo does not vendor: the compiler, and two
upstream sources that are fetched and built rather than copied in (`versions.json`
pins them). Each has a default location and an environment override.

| Dependency | Default location | Override |
| --- | --- | --- |
| [scriptc](https://github.com/vercel-labs/scriptc) | `../scriptc/packages/cli/dist/main.js` (a sibling checkout) | `SCRIPTC_BIN` |
| [build-libcanvas](https://github.com/monteslu/build-libcanvas) output | `~/code/cliemu/build-libcanvas/out/<target>` | `LIBCANVAS_OUT` |
| [webaudio-node](https://github.com/monteslu/webaudio-node) source | `~/code/cliemu/webaudio-node` | `WEBAUDIO_SRC` |

Run the two vendor steps once, then build:

```sh
./scripts/fetch-archives.sh        # vendor/<target>/libskiac.a  + headers
./scripts/build-webaudio.sh        # vendor/<target>/libwebaudio.a
./scripts/build.sh examples/dodge  # -> build/dodge
./scripts/test.sh                  # every suite, headless
```

Skipping either vendor step fails at link time with a missing-archive error
(`ar: ... libskiac.a: No such file or directory`, or an FFI manifest complaint
about `libwebaudio.a`) rather than anything self-explanatory.

## Credits

This project is assembled from other people's work. Each of these does the heavy
lifting for one part of the stack.

| Project | Role here | License |
| --- | --- | --- |
| **[scriptc](https://github.com/vercel-labs/scriptc)** <br><sub>vercel-labs</sub> | Compiles ordinary TypeScript and JavaScript to small, fast native executables, with no Node, V8, or JS engine in the binary. **The compiler this whole project is built on.** Its `--ffi` manifest is how TypeScript reaches C. | Apache-2.0 |
| **[jsgamelauncher](https://github.com/monteslu/jsgamelauncher)** <br><sub>monteslu</sub> | Runs web games without a browser or Electron, on cheap retro handhelds and desktops. **The design this project follows**: game directory as web root, entry resolution by convention, and the "just develop your game for the browser" contract. | MIT |
| **[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas)** <br><sub>Brooooooklyn</sub> | Canvas for Node.js with a Skia backend. Its `skia_c.hpp` C surface is what our Canvas 2D binds to directly (skipping N-API and Rust), and its rendering is the **golden reference** our conformance suite compares against pixel-for-pixel. | MIT |
| **[webaudio-node](https://github.com/monteslu/webaudio-node)** <br><sub>monteslu</sub> | A full Web Audio API for Node.js. Its C++ graph engine (15 node types, params, FFT, mixer, resampler) is compiled **natively** here and driven from an SDL audio thread. Used byte-identical to upstream. | ISC |
| **[gamepad-node](https://github.com/monteslu/gamepad-node)** <br><sub>monteslu</sub> | The browser Gamepad API for Node.js over native SDL2. Reference for our Standard Gamepad mapping and the polling model behind `navigator.getGamepads()`. | ISC |
| **[node-sdl](https://github.com/kmamal/node-sdl)** <br><sub>kmamal</sub> | SDL bindings for Node.js. Prior art for how a JS runtime drives SDL windows, events and audio. We bind SDL's C ABI directly, but the shape of the problem was mapped here first. | MIT |
| **[webgl-node](https://github.com/monteslu/webgl-node)** <br><sub>monteslu</sub> | A WebGL2 implementation for Node.js on top of native-gles. Its semantics layer is the owned, debugged reference the planned WebGL2 tier ports from. | MIT |
| **[native-gles](https://github.com/monteslu/native-gles)** <br><sub>monteslu</sub> | OpenGL ES 3.0 bindings via EGL, native on Linux/ARM and ANGLE on macOS/Windows. Proves the link shape (`-lEGL -lGLESv2`) the 3D tier will use; its N-API-free context code provides the headless path. | MIT |
| **[wasmcart](https://github.com/monteslu/wasmcart)** <br><sub>monteslu</sub> | A WASM cartridge host for sandboxed `.wasm` game carts. **A future compile target:** the same web-shaped source could emit a cart instead of a native binary. | MIT |

Also relied on:

| Project | Role here | License |
| --- | --- | --- |
| **[SDL2](https://libsdl.org)** | Window, input, audio device, controller database | zlib |
| **[Skia](https://skia.org)** | The rasterizer behind Canvas 2D | BSD-3 |
| **[build-libcanvas](https://github.com/monteslu/build-libcanvas)** | Pre-built static Skia + `skia_c.hpp` per platform, pinned by `CANVAS_VERSION` | (build tooling) |
| **[dr_libs](https://github.com/mackron/dr_libs)** | mp3, wav and flac decoding | public domain / MIT |
| **[stb_vorbis](https://github.com/nothings/stb)** | ogg decoding | public domain / MIT |
| **[DejaVu Fonts](https://dejavu-fonts.github.io/)** | Test and example typeface | Bitstream Vera |

## Documents

| File | Contents |
| --- | --- |
| [docs/WRITING-GAMES.md](docs/WRITING-GAMES.md) | **Start here to write a game**: the API, assets, the loop, what differs from a browser |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The three tiers, handle tables, threading, frame loop, present path |
| [docs/API-SURFACE.md](docs/API-SURFACE.md) | Exact supported surface per spec, with support tiers |
| [docs/FFI-SHIM.md](docs/FFI-SHIM.md) | The C shim: manifest, handle tables, event/string protocols, codegen |
| [docs/DIALECT.md](docs/DIALECT.md) | The scriptc TS dialect game code must obey, with rewrite patterns |
| [docs/WEBGL-AND-3D.md](docs/WEBGL-AND-3D.md) | WebGL2 tier + the planned 3D library |
| [docs/BUILD-AND-CI.md](docs/BUILD-AND-CI.md) | Archive matrix, cross-compilation, CI design, packaging |
| [docs/SPIKE-RESULTS.md](docs/SPIKE-RESULTS.md) | Engineering notes: measurements, upstream quirks, every bug found |

## Project notes

- **Games are TypeScript** because that is scriptc's input language; the type
  annotations are the compilation contract. Dev tooling (codegen, build scripts,
  asset bakers) stays plain JS ESM since nothing compiles it.
- **Native compilation is the point here.** This does not touch romdev, where
  WASM remains the point. Separate product, separate trade-off. wasmcart is the
  exception, being a plausible future *target* for the same source.
