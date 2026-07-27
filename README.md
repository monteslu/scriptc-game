# scriptc-game

**Working title. Public name TBD by monteslu before anything is published.**

A native game framework: games written in strictly-typed TypeScript against a
familiar web-shaped API (Canvas 2D + Web Audio + Gamepad), compiled ahead-of-time
to a single self-contained native binary by [scriptc](https://github.com/vercel-labs/scriptc),
with Skia, SDL2, and the webaudio-node C++ graph engine statically linked behind
a C-ABI shim.

No Node. No V8. No quickjs. No WASM. One binary, ~2.4ms startup.

## The one-paragraph pitch

jsgame-libretro already runs real, unmodified web JS games natively (libnode +
canvas + WebGL2). This project is its complement at the other end of the
trade-off curve: games written in a strict TS dialect ("familiar, not
compatible", the same positioning that worked for gtlua) compile to a tiny
static binary with AOT-native game logic and direct C calls into Skia/SDL,
instead of a 120MB embedded Node runtime. Existing web games do not port
unmodified; new games and new games get a dramatically better
deployment shape.

## Why this is feasible (research summary, 2026-07-27)

- **scriptc** (vercel-labs, v0.0.17) compiles ordinary TypeScript to native
  executables via a C/LLVM backend. Static tier: no JS engine in the binary,
  refcounted GC, fibers for async, large stdlib + Node API surface. Native
  interop is `--ffi`: a JSON manifest binds TS declarations to C ABI symbols
  from static archives. Fully static builds cross-compile via zig.
- **Canvas**: we do NOT go through @napi-rs/canvas's N-API or Rust layers.
  build-libcanvas (sibling repo) already builds Skia per platform in CI, and
  its `src/canvas/skia-c/skia_c.hpp` is one `extern "C"` block with **237
  `skiac_*` functions** covering the entire canvas surface (36 path, 31 canvas,
  22 paint, 18 surface, 18 matrix, 15 font, 11 image, plus gradients, images,
  pictures, SVG/PDF/Skottie). That is a ready-made FFI target.
- **Window/events/present**: SDL2 is plain C ABI. The node-sdl N-API addon was
  only ever the V8 bridge; we bind SDL directly.
- **Audio**: webaudio-node's graph engine is portable C++ (15 node types,
  params, FFT, mixer, resampler, dr_libs/stb_vorbis/fdk-aac decoders) currently
  compiled to WASM with Emscripten. Recompiled with clang into a native `.a`,
  it renders on a native SDL audio thread with zero callbacks crossing the FFI.
- **Gamepad**: gamepad-node is pure JS over SDL joystick polling. It ports to
  the TS runtime layer directly; SDL_GameController gives the mapping database.
- **WebGL / 3D (roadmap, Phases 8/9)**: GL object names are already u32, so
  most of GLES3's ~246 entry points FFI-bind directly to
  libEGL/libGLESv2 (`-lEGL -lGLESv2`, the exact link shape native-gles's
  binding.gyp proves out); webgl-node's 1,275-line WebGL2 semantics layer is
  the owned, debugged reference that ports to the dialect; native-gles's
  N-API-free `egl_context.cpp` provides the headless context path. On top:
  **threeTS-lite**, a three-shaped (not three-compatible) game-sized 3D
  library written scriptc-clean, since three.js itself ships plain JS with
  dynamic patterns the static tier fences. See docs/WEBGL-AND-3D.md.

The single piece of new native code is a small **flattening shim** (see
`docs/FFI-SHIM.md`) that adapts pointer-and-struct C APIs to scriptc's
FFI format 1 (scalars in, scalars out, byte buffers in only).

## Documents

| File | Contents |
| --- | --- |
| [PLAN.md](PLAN.md) | Master phased plan: tasks, deliverables, acceptance gates |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, handle tables, threading, main loop, present path |
| [docs/FFI-SHIM.md](docs/FFI-SHIM.md) | The C shim spec: manifest, handle tables, event/string protocols, codegen |
| [docs/API-SURFACE.md](docs/API-SURFACE.md) | Exact framework API: Canvas 2D / Web Audio / Gamepad / loop, with support tiers |
| [docs/DIALECT.md](docs/DIALECT.md) | The scriptc TS dialect game code must obey, with rewrite patterns |
| [docs/WEBGL-AND-3D.md](docs/WEBGL-AND-3D.md) | WebGL2 tier (webgl-node port over GLES3 FFI) + threeTS-lite 3D library |
| [docs/BUILD-AND-CI.md](docs/BUILD-AND-CI.md) | Archive matrix, cross-compilation, CI design, packaging |
| [docs/RISKS.md](docs/RISKS.md) | Risk register, kill criteria, open questions |

## Status

Planning. Nothing built yet. Phase 0 (toolchain validation spike) is the gate
for everything else; see PLAN.md.

## Project notes

- **This project is TypeScript** (runtime library, threeTS-lite, and game
  code): TS is scriptc's input language and the type annotations are the
  compilation contract. Dev tooling (codegen, build scripts, asset bakers)
  stays plain JS ESM since nothing compiles it.
- **Native compilation is the point here.** This does not touch wasmcart or
  romdev, where WASM remains the point. Separate product, separate trade-off.
