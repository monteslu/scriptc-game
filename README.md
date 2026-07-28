# scriptc-game

**Write a browser game. Compile it to a NATIVE binary.**
**No chromium, No Electron, No node.js, No bun, No JIT, No V8**


A game here is ordinary web code: `document.getElementById`, `getContext("2d")`,
`requestAnimationFrame`, `new Image()`, `fetch`, Web Audio, `navigator.getGamepads()`,
and WebGL2. It compiles ahead of time into one self-contained executable, with
Skia, SDL2, GLES3 and the webaudio-node C++ graph statically linked behind a
C-ABI shim.

3D is a first-class target: **threeTS-lite** is a three.js-shaped renderer
(`Scene`, `Mesh`, `PerspectiveCamera`, materials, lights, `InstancedMesh`,
`Raycaster`) that runs the same source natively and in a page. See
[docs/WEBGL-AND-3D.md](docs/WEBGL-AND-3D.md).

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
| **WebGL2** | The GLES3 surface behind a `WebGL2RenderingContext`: buffers, VAOs, shaders, textures, FBOs, instancing, `getContextGL()` on a canvas |
| **3D** | threeTS-lite: `Scene`, `Object3D`, `Mesh`, `InstancedMesh`, `Sprite`, `Line`, `Points`, Basic/Lambert/Standard materials, ambient/directional/point/hemisphere lights, fog, render targets, `Raycaster`, and a glTF/GLB/OBJ mesh baker |
| **Build** | One command from a game directory to a self-contained native binary |

| Target | Runner | Notes |
| --- | --- | --- |
| linux-x86_64 | ubuntu-24.04 | |
| linux-aarch64 | ubuntu-24.04-arm | |
| macos-aarch64 | macos-14 | frameworks via Mach-O linker options |
| macos-x86_64 | macos-15-intel | |

Each target builds on its own runner rather than cross-compiling. scriptc
can cross-compile, but Skia, SDL2 and the audio graph are per-platform
binaries, so only a native runner links a real result.

Windows is not a target yet, and the blocker is a standoff between two
upstreams rather than anything here. scriptc's Windows support is built for
mingw: 16 of its 54 runtime translation units include POSIX headers
(`dirent.h`, `unistd.h`, `poll.h`) unguarded, which mingw-w64 provides and
MSVC does not. Skia's GN goes the other way, routing every `target_os="win"`
build to its `msvc` toolchain, so build-libcanvas can only publish an MSVC
Skia whose objects import a CRT mingw cannot supply. Verified locally: the
gnu triple compiles scriptc programs cleanly and cannot link Skia; the MSVC
triple links Skia and cannot compile the runtime.

Everything on this side is done: `fetch-archives.sh` vendors the Windows
archives (204 skiac symbols) and `build-shim.sh` merges them, both checked
against the real release tarball. Two of the MSVC-side compiler gaps are
already fixed on branches (see the table above). The likely path to Windows
is a wasmcart build rather than a native one, which avoids the toolchain
question entirely.

**Android is blocked upstream**: scriptc has no Android support, and its
cross path goes through `zig cc`, which cannot be pointed at an NDK
sysroot. This side is ready, since `fetch-archives.sh` vendors the target
today.

macOS needs Skia's platform frameworks (CoreText for fonts), which link with
`-framework Foo` while scriptc's manifest only emits `-l<name>`.
`shim/sg_macos_frameworks.c` carries them as Mach-O `LC_LINKER_OPTION` load
commands inside `libsggfx.a`, so the linker finds them without the manifest
knowing. Same mechanism as Rust's `#[link(kind = "framework")]`.

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
| Web surface | **18/18** checks |
| WebGL2 | **9/9** checks on a real GPU, including a control that must fail |
| three math | **15/15** checks against real three.js values |
| Raycaster + loaders | **75/75** checks |
| Phase 9 closeout | render targets, hemisphere light and Standard material, each with a control render that must differ |
| Pixel readback | passing |

Every one of the 13 examples also runs in a browser from the same source,
checked by `./browser/test.sh` (13/13 at the last run).

Assets shared by more than one example live once in `examples/shared/` and are
symlinked into each game's `public/`. Windows clones need `core.symlinks`
enabled; see [examples/shared/README.md](examples/shared/README.md).

Thirteen examples. 2D: `minimal` (no engine, no assets), `bounce` (the
engine's fixed-step loop), `inputs` (keyboard, mouse and gamepad state),
`loader` (the optional asset loader with a progress bar), `dodge` (the
reference game), `paddle` (swept collision and a CPU opponent), `scroller`
(tilemap platformer with a scrolling camera) and `synth` (a playable Web
Audio graph).

3D: `cube` (the smallest WebGL2 scene), `runner` (a 3D endless runner),
`orbits` (Kenney Space Kit models, CC0), `spinfield` (the threeTS-lite
benchmark: instanced vs per-mesh, same per-cube math) and `station` (a
Descent-style 6DOF ship flight through a branching tunnel network, with
fog, a laser weapon and music).

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

Build from the `game-integration` branch of
[monteslu/scriptc](https://github.com/monteslu/scriptc), which carries two
compiler fixes this project needs. Each lives on its own topic branch, kept
separate and self-contained so any one can go upstream on its own:

| Branch | What it fixes |
| --- | --- |
| `fix/ffi-const-binding` | An FFI-bound call is silently dropped when its result initializes a never-reassigned local: the build succeeds and the program dies at load ([vercel-labs/scriptc#21](https://github.com/vercel-labs/scriptc/issues/21)) |
| `fix/msvc-ssize-t` | `scr_runtime.h` declares `ssize_t` function pointers, which MSVC does not define, so any Windows build through that header fails to parse |
| `fix/msvc-posix-time` | Five runtime TUs call `clock_gettime` / `nanosleep`; mingw-w64 ships both, MSVC ships neither, so an `x86_64-windows-msvc` build does not compile |
| [build-libcanvas](https://github.com/monteslu/build-libcanvas) output | `~/code/cliemu/build-libcanvas/out/<target>` | `LIBCANVAS_OUT` |
| [webaudio-node](https://github.com/monteslu/webaudio-node) source | `~/code/cliemu/webaudio-node` | `WEBAUDIO_SRC` |

Run the two vendor steps once, then build:

```sh
./scripts/fetch-archives.sh        # vendor/<target>/libskiac.a  + headers
./scripts/build-webaudio.sh        # vendor/<target>/libwebaudio.a
./scripts/fetch-angle.sh           # macOS only: GLES3 via ANGLE
./scripts/build.sh examples/dodge  # -> build/dodge
./scripts/dev.sh examples/dodge    # rebuild + relaunch on every save
./scripts/typecheck.sh             # tsc only, ~0.4s
./scripts/test.sh                  # every suite, headless
./browser/test.sh                  # every example, in a real browser
```

A 3D example needs a mappable window, or `SG_HEADLESS=1` to render into an
offscreen EGL pbuffer instead:

```sh
./scripts/build.sh examples/station && ./build/station
SG_HEADLESS=1 ./build/spinfield    # benchmark with no compositor
```

`dev.sh` watches the game plus `web/`, `engine/`, `host/` and `shim/`. A
game-code change is about 7 seconds end to end, since the C++ shim is only
recompiled when it actually changes. Install `inotify-tools` for instant
change detection; without it the watcher polls once a second.

Skipping either vendor step fails at link time with a missing-archive error
(`ar: ... libskiac.a: No such file or directory`, or an FFI manifest complaint
about `libwebaudio.a`) rather than anything self-explanatory.

## License

MIT. See [LICENSE](LICENSE).

Every dependency below is permissively licensed and nothing linked into the
output binary imposes a copyleft obligation.

## What this project needs from the compiler

scriptc is doing the hard part, and these are the places a game-shaped
workload pushes past what it currently offers. Listed plainly because
they are useful signal, not complaints: two have fixes on branches above,
and the rest are worked around here.

| Need | Status |
| --- | --- |
| FFI call not dropped when its result initializes a `const` | fixed on `fix/ffi-const-binding`, filed as [#21](https://github.com/vercel-labs/scriptc/issues/21) |
| `ssize_t` on MSVC | fixed on `fix/msvc-ssize-t` |
| `clock_gettime` / `nanosleep` on MSVC | fixed on `fix/msvc-posix-time`. Needed because Windows here must use the **MSVC** triple: Skia is MSVC-built and mingw cannot supply the CRT its objects import |
| An **`f32`** FFI class | worked around. `f64` is the only float class, so every `float`-taking C function needs a narrowing wrapper. Free at runtime (one `cvtsd2ss`, measured as noise) but pure code volume: the GLES3 surface alone has 18 such entry points. See [docs/FFI-SHIM.md](docs/FFI-SHIM.md) |
| **Ambient globals** (a value, not just `declare function`) | worked around. Games import their browser globals from one module instead of getting them ambiently; that import line is the single thing separating this source from literal browser code. See [docs/WRITING-GAMES.md](docs/WRITING-GAMES.md) |
| **Function overloads** in the dialect | worked around. `drawImage` handles its three spec arities with a rest parameter; `addEventListener` cannot, so `KeyboardEvent` and `MouseEvent` are one record. See [docs/WRITING-GAMES.md](docs/WRITING-GAMES.md) |
| A **framework** spelling in `system_libraries` | worked around. Entries become `-l<name>`, so macOS frameworks ride in as Mach-O `LC_LINKER_OPTION` load commands compiled into the archive |

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
| **[webgl-node](https://github.com/monteslu/webgl-node)** <br><sub>monteslu</sub> | A WebGL2 implementation for Node.js on top of native-gles. Its semantics layer is the owned, debugged reference our WebGL2 tier ports from. | MIT |
| **[native-gles](https://github.com/monteslu/native-gles)** <br><sub>monteslu</sub> | OpenGL ES 3.0 bindings via EGL, native on Linux/ARM and ANGLE on macOS/Windows. Establishes the link shape (`-lEGL -lGLESv2`) the 3D tier uses, the pinned ANGLE build macOS needs, and the N-API-free EGL context our `SG_HEADLESS` path is modelled on. | MIT |
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
| [docs/WEBGL-AND-3D.md](docs/WEBGL-AND-3D.md) | The WebGL2 tier and threeTS-lite: what shipped, where it differs from three, and the benchmarks |
| [docs/BUILD-AND-CI.md](docs/BUILD-AND-CI.md) | Archive matrix, cross-compilation, CI design, packaging |
| [docs/SPIKE-RESULTS.md](docs/SPIKE-RESULTS.md) | Engineering notes: measurements, upstream quirks, every bug found |

## Project notes

- **Games are TypeScript** because that is scriptc's input language; the type
  annotations are the compilation contract. Dev tooling (codegen, build scripts,
  asset bakers) stays plain JS ESM since nothing compiles it.
- **Native compilation is the point here.** This does not touch romdev, where
  WASM remains the point. Separate product, separate trade-off. wasmcart is the
  exception, being a plausible future *target* for the same source.
