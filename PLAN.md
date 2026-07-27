# scriptc-game: Master Plan

Everything below is phased so that each phase produces a runnable artifact and
a go/no-go signal before the next phase spends effort. Phase 0 is cheap and
exists to kill the project early if scriptc's ground truth diverges from its
docs. Estimates assume one focused agent-day per "day".

Repository layout this plan builds toward:

```
scriptc-game/
  README.md  PLAN.md  docs/
  shim/                  # C sources: sg_*.c/.h (hand-written core + generated)
  codegen/               # plain-JS ESM generators: skia_c.hpp -> shim/ffi/dts
  runtime/               # the framework TypeScript (the TS exception)
    canvas/  audio/  input/  loop/  assets/
  ffi/                   # ffi.json manifests (generated + hand-written parts)
  vendor/                # fetched per-target archives, NOT committed
  versions.json          # pins: scriptc, SDL, CANVAS_VERSION, webaudio-node
  scripts/               # build.sh, fetch-archives.sh, patches/ if any
  examples/              # pong-like, sprite demo, audio demo (generic names)
  test/                  # conformance scenes, golden PNGs, offline-audio hashes
```

Conventions carried over from the rest of cliemu:

- Upstream is FETCHED, not vendored; pins live in `versions.json`.
- Patches (if any) live in `scripts/patches/` with a matching build script.
- No hardcoded home-directory paths anywhere in the tree.
- Dev tools are plain JS ESM. Only `runtime/` and `examples/` are TS.
- End-user docs never name commercial games.
- Public repo/package naming is monteslu's call; flag and wait.

---

## Phase 0: Toolchain validation spike (1 day) [GATE]

Cheap experiments that decide whether the whole plan is real. Every result
gets recorded in `docs/SPIKE-RESULTS.md` with exact versions and numbers.

### Tasks

- **0.1 Linux-host scriptc.** `npm i -g scriptc` on the Linux dev box
  (clang installed), build hello-world static. The npm package has no `os`
  restriction and the compiler is a Node program that shells out to clang, but
  macOS arm64 is the documented primary platform. If the Linux host fails,
  fall back to a macOS build host (CI runner or local machine) and note the
  friction; that alone does not kill the project because static builds
  cross-compile to Linux via zig.
- **0.2 FFI hello.** Tiny C archive with one function per ABI class
  (`f64`, `bool`, `u8`, `u32`, `i32`, `string`, `bytes`, `void` return).
  Verify the manifest format against scriptc 0.0.17 exactly as pinned.
- **0.3 FFI call overhead.** Loop 10M calls to a trivial `f64(f64)` native
  function; measure ns/call. Target: < 100ns (docs claim direct C calls with
  no engine at the boundary; expect near-native). Record the number; it sizes
  how hard Phase 7 batching matters.
- **0.4 Float32Array-as-bytes.** The `bytes` ABI class accepts
  `Uint8Array | Buffer`. Verify that `new Uint8Array(f32.buffer, off, len)`
  compiles in scriptc's static tier and arrives in C with the right bits.
  This is the bulk-upload path for matrices, path data, and audio buffers.
  Fallback if fenced: explicit byte-packing helper or scalar args.
- **0.5 Long-running loop stability.** A `while(true)` frame loop with
  allocation churn (create/drop records and arrays per iteration) run for
  10 minutes; watch RSS. Verifies refcount GC + cycle collection behave in a
  game-shaped workload. Also run once under `--sanitize` on the host lane.
- **0.6 Threading tolerance.** C archive spawns a pthread that writes to
  shim-owned memory; TS main loop reads results via getter FFI calls for 60s.
  Verifies scriptc's runtime tolerates a foreign native thread (it should:
  native code is explicitly outside its contracts, but verify, since the
  audio engine depends on it).
- **0.7 fs + typed arrays.** `fs.readFileSync` a binary file into a
  Uint8Array and pass it across FFI (the asset-loading path).
- **0.8 License check.** Read scriptc's LICENSE and confirm redistribution
  terms are compatible with shipping games built with it.
- **0.9 Class accessors.** Do getters/setters compile in the static tier?
  (`get drawingBufferWidth()` shapes in the WebGL tier; `.position` /
  computed properties in threeTS-lite.) Fallback everywhere is methods;
  the answer just picks API shapes early.
- **0.10 Shared-library linking.** `system_libraries: ["EGL", "GLESv2"]`
  against a trivial EGL query call. Confirms the Phase 8 GL tier links the
  way native-gles's binding.gyp proves the toolchain shape (`-lEGL
  -lGLESv2`). Not a gate for v0.1 (2D links static archives only).

### Acceptance gate

All of 0.2, 0.3, 0.4 (or its fallback), 0.5, 0.6, 0.7 pass. 0.1 may
fail-with-fallback. If FFI overhead is > 1µs/call or the runtime is unstable
under a foreign thread, STOP and write up findings; the plan dies cheap.

---

## Phase 1: Window + bouncing square PoC (2 days) [GATE]

The smallest end-to-end slice: scriptc-built TS main loop, SDL window, Skia
raster drawing, vsync present, keyboard input.

### Tasks

- **1.1 Vendor fetch.** `scripts/fetch-archives.sh`: pull the linux-x86_64
  Skia archives + `skia_c.hpp` from build-libcanvas releases (pin
  CANVAS_VERSION), and a static SDL2 (`libSDL2.a`) built with the video,
  events, timer, joystick, haptic, audio subsystems. Record exact provenance
  in `versions.json`.
- **1.2 Shim v0 (hand-written, ~400 lines C).**
  - `sg_init(w: u32, h: u32, flags: u32) -> i32` (SDL init + window +
    renderer + streaming texture + raster SkSurface via `skiac_surface_*`).
  - Handle tables for surface/canvas/paint/path (see docs/FFI-SHIM.md).
  - ~25 wrapped skiac calls: surface create/destroy, canvas clear, save,
    restore, translate, rotate, scale, draw_rect, draw_path, clip_rect;
    paint create/set_color/set_style/set_stroke_width/set_alpha; path
    create/move_to/line_to/cubic_to/close/reset.
  - `sg_present() -> void` (surface pixels -> SDL_UpdateTexture ->
    RenderCopy -> RenderPresent; renderer created with PRESENTVSYNC).
  - `sg_poll_event() -> u32` + scalar event getters; `sg_ticks() -> f64`.
- **1.3 ffi.json v0** for the above, hand-written.
- **1.4 Runtime v0 (TS).** `runtime/loop/` main-loop scaffold,
  `runtime/canvas/` a 10-method Context2D subset, `runtime/input/` keyboard
  state map. Example: `examples/bounce/` square bouncing at 60fps, arrow keys
  nudge it, ESC quits.
- **1.5 Measurements.** fps stability over 60s, RSS, binary size, CPU %,
  frame-time histogram (via `sg_ticks`), input-to-photon sanity by eye.
  Record in SPIKE-RESULTS.md.

### Acceptance gate

Locked 60fps with vsync on the Linux box, RSS under 64MB, no leaks over 10
minutes (handle-table count getters report steady state). If present-path
copies dominate frame time at 1080p, note it; the GPU path (Phase 7) is the
lever, not a blocker at PoC resolutions.

---

## Phase 2: Full Canvas 2D (5 days)

### Tasks

- **2.1 Codegen.** `codegen/gen-shim.js` (plain JS ESM) parses
  `skia_c.hpp` and emits, from one source of truth, three artifacts:
  1. `shim/sg_skia_gen.c`: handle-table-flattened wrappers for every needed
     `skiac_*` function,
  2. `ffi/skia.ffi.json` fragment,
  3. `runtime/canvas/ffi.d.ts`: the matching `declare function` block.
  Hand-written override list for functions needing custom marshalling
  (string returns, struct params, byte outputs). The generator is dumb and
  regex-y on purpose; skia_c.hpp is machine-regular.
- **2.2 Context2D complete.** Implement the full supported tier from
  docs/API-SURFACE.md: all path verbs and fill rules, transforms +
  getTransform, fill/stroke styles with CSS color parsing (pure TS),
  linear/radial/conic gradients (`skiac_shader_*`), patterns, line dash,
  globalAlpha, globalCompositeOperation (paint blend modes), clip,
  shadows (deferred if skiac requires a looper; check), imageSmoothing.
- **2.3 Text.** `skiac_font_*` + `skiac_canvas_get_line_metrics_or_draw_text`:
  fillText/strokeText/measureText, font shorthand parser (pure TS),
  `fonts.register(path)` backed by typeface loading. textAlign/textBaseline.
- **2.4 Images.** Asset loader: `fs.readFileSync` -> bytes -> shim decode
  (`skiac_bitmap_*`/`skiac_image_*`) -> u32 image handle. drawImage all three
  overloads, createImageData/putImageData (pixels IN via bytes is supported).
  getImageData: implement the slow per-pixel scalar path behind a
  `ctx.readback` namespace with a loud doc warning, plus
  `sg_surface_save_png(handle, path)` for the real use case (screenshots).
- **2.5 Conformance harness.** `test/scenes/*.ts`: ~40 deterministic scenes
  (one per feature family). Harness renders each headless (SDL dummy video
  driver, raster surface), saves PNG via shim, and pixel-compares against
  goldens rendered by Node + @napi-rs/canvas **at the same pinned
  CANVAS_VERSION/Skia**. Same Skia, same version: demand byte-identical,
  investigate any diff.

### Acceptance

All conformance scenes byte-identical to the napi-rs/canvas goldens, headless
harness runs in CI-shape (no window, no GPU).

---

## Phase 3: Input (2 days)

### Tasks

- **3.1 Events complete.** Full SDL event coverage through the scalar-getter
  protocol: keyboard (scancode, keycode, repeat, mods), mouse
  (motion/button/wheel), window (close/resize/focus/shown), text input
  (UTF-8 via per-byte getter), controller add/remove.
- **3.2 Gamepad API.** Port gamepad-node's TS-visible surface:
  `getGamepads()` returning Gamepad-shaped records (id, index, connected,
  axes, buttons with value/pressed), standard mapping via SDL_GameController.
  Load extra mappings with `SDL_GameControllerAddMapping` (the
  EmulationStation cfg parser from gamepad-node ports to TS if still wanted;
  SDL's own DB covers most). Haptics: `vibrationActuator.playEffect` ->
  `SDL_GameControllerRumble`.
- **3.3 Framework input layer.** Polled state API (`input.isDown('KeyA')`,
  `input.gamepad(0)`) layered over the event stream, since polled is what
  game loops actually want; raw event subscription also exposed.

### Acceptance

A test page draws live state of every axis/button of two physical pads +
keyboard + mouse; hot-plug works; rumble works.

---

## Phase 4: Audio (5 days)

### Tasks

- **4.1 Emscripten audit.** Sweep webaudio-node `src/wasm/` for
  emscripten-isms (`emscripten.h`, EM_ASM, exported-function glue, WASM
  memory assumptions). Expectation from the file layout (15 node .cpps,
  audio_param, fft, mixer, resampler, RingBuffer.h): mostly portable C++
  with a thin export surface. Produce the diff list.
- **4.2 Native build.** `scripts/build-webaudio.sh`: clang -O2 the graph
  core + decoders (dr_libs, stb_vorbis, fdk-aac) into `libwebaudio.a` per
  target. New C ABI entry points (`wa_*`) replacing the WASM glue: context
  create/destroy, node create (type enum) -> u32, connect/disconnect,
  param set/schedule (setValueAtTime, linearRamp, exponentialRamp, target),
  buffer create from decoded bytes, source start/stop with when/offset,
  render-quantum pump.
- **4.3 Audio thread.** Shim owns an SDL audio device + thread. Main-thread
  FFI calls append graph commands to a lock-free SPSC ring (the pattern
  webaudio-node already uses across the JS/WASM boundary); the audio thread
  drains commands at quantum boundaries and renders. No scriptc memory is
  ever touched off-main-thread.
- **4.4 TS Web Audio layer.** `runtime/audio/`: AudioContext, destination,
  and the 15 node classes (analyser, biquad, bufferSource, channelMerger,
  channelSplitter, constantSource, convolver, delay, dynamicsCompressor,
  gain, iirFilter, oscillator, panner, stereoPanner, waveShaper) as handle
  wrappers with AudioParam objects. `decodeAudioData(bytes)` is synchronous
  native decode returning a buffer handle (wrapped in a resolved Promise for
  API familiarity). Analyser readback via per-bin scalar getter (documented
  cost: one FFI call per bin, fine at direct-call prices).
- **4.5 Parity tests.** OfflineAudioContext-style render-to-hash: run the
  same graph in webaudio-node (WASM build, under Node) and here; same C++
  core + same sample rate should be bit-exact. Any divergence is a port bug.

### Acceptance

Offline render hashes match the WASM build for a test suite covering every
node type; live playback is glitch-free (no underruns at 128-frame quantum)
while the main loop renders at 60fps.

---

## Phase 5: Framework assembly + developer experience (4 days)

### Tasks

- **5.1 Public API shape.** One import surface (working name `sg`):
  `sg.run({width, height, title, update(dt), draw(ctx)})` owning the loop
  (no requestAnimationFrame pretense; the framework owns the loop, the
  jsgame lesson formalized). `sg.audio`, `sg.input`, `sg.assets`,
  `sg.screen`. Fixed-timestep update with accumulator + interpolated
  render option.
- **5.2 Assets.** `sg.assets.load()` manifest loader (images, audio,
  fonts, JSON) from an `assets/` dir resolved relative to the binary;
  `comptime()` baking for small metadata (atlas frames, input maps) and
  documented but discouraged for large blobs (compile-time cost).
- **5.3 Scaffolding.** `create-scriptc-game` style template (plain files,
  no generator dependency): tsconfig pinned to scriptc's world, ffi
  manifests, build script, one-command `./scripts/dev.sh` that rebuilds and
  relaunches on change (measure scriptc rebuild latency; record it).
- **5.4 Dialect lint.** ESLint preset approximating scriptc's fences
  (no-any, eqeqeq, no-var, no-labels, no-generic-classes, etc.) for fast
  editor feedback; the authoritative check remains `scriptc build`. Document
  in DIALECT.md that the compiler's SC-coded diagnostics with rewrite hints
  are the real contract.
- **5.5 Examples.** `examples/paddle/` (pong-like), `examples/scroller/`
  (sprite platformer with tilemap, gamepad, SFX + music),
  `examples/synth/` (audio graph playground). Generic names only.

### Acceptance

Fresh clone + `./scripts/fetch-archives.sh` + one build command produces a
running native example on Linux; examples exercise every runtime subsystem.

---

## Phase 6: Cross-compile, CI, packaging (3 days)

### Tasks

- **6.1 Target matrix.** linux-x86_64, linux-arm64, macos-arm64,
  windows-x86_64. Per-target archive sets (Skia from build-libcanvas CI
  already does this per platform; SDL2 and libwebaudio join the same
  release-artifact pattern). Note: scriptc cross-compiles static programs
  from a macOS host via `SCRIPTC_CC=zigcc SCRIPTC_TARGET=...`; FFI archives
  must match the target, which the matrix provides. Windows caveat: scriptc
  itself lacks servers/child_process there, irrelevant for games; SDL and
  Skia are fine.
- **6.2 CI.** Per-target: build all examples, run the headless conformance
  suite (canvas goldens + audio hashes) under the dummy SDL drivers. Linux
  runners execute natively; macos-arm64 runner covers both native build and
  the cross-compile lane.
- **6.3 Size/startup report.** CI publishes binary size and cold-start time
  per example per target, tracked over time (the deployment shape IS the
  product; regressions here are bugs).

### Acceptance

Green matrix; a downloaded artifact runs on a clean machine with zero
installed dependencies.

---

## Phase 7: Stretch (unscheduled, 2D-tier refinements)

- **GPU present path.** Ganesh GL-backed SkSurface sharing an SDL GL
  context (build-libcanvas's `ganesh-gpu.patch` already adds the GPU surface
  C API); flush + swap instead of the CPU copy. Removes the 1080p+ present
  bottleneck. Mind the `skia_gl_standard` dialect pitfall (gles on ANGLE/ARM,
  gl on desktop core) documented in build-libcanvas. Optional once Phase 8
  lands (the SDL GL window model covers the 3D tier without it; Ganesh
  composite then only serves canvas-heavy 2D games at high resolution).
- **Draw-call batching.** Command buffer in a Uint8Array flushed once per
  frame through a single bytes call, if Phase 0's overhead number times
  real-game call counts ever shows up in profiles. Expected unnecessary.
- **Skottie/SVG/PDF exposure.** skiac already ships 15 skottie + svg + pdf
  functions; cheap wins for menus/cutscenes and asset pipelines.
- **Watch scriptc releases** for: FFI callbacks, owned pointer/bytes
  returns, struct-by-value, `--lib` FFI, integer inference/ownership
  analysis. Each one deletes shim code or raises the perf ceiling; none are
  prerequisites.

---

## Phase 8: WebGL2 tier (6 days) [post-v0.1]

Full spec: `docs/WEBGL-AND-3D.md`. Summary: a WebGL2RenderingContext-shaped
dialect-TS class over raw GLES3 FFI. GL object names are already u32, so
most of the ~246 entry points bind straight from the manifest to
libEGL/libGLESv2 (`system_libraries`, the exact `-lEGL -lGLESv2` shape
native-gles's binding.gyp uses) with zero shim code; a ~600-line shim
covers out-params (scratch-slot getters), info logs (string mailbox),
readback (native-side hash/save sinks), and the lone pointer object
(GLsync handle table). The semantics layer is a port of webgl-node's
1,275-line `webgl2-context.mjs` (owned, debugged, 267 call sites mapping
1:1). Context/present: SDL GL window preferred; native-gles's N-API-free
`egl_context.cpp` compiles into the shim for the headless/pbuffer lane.

### Tasks

- **8.1** GL codegen (registry or native-gles function list -> manifest +
  declares + shim pass-throughs); linking spike results (0.10) applied per
  platform; ANGLE dylib linking verified on macos/windows or tier ships
  Linux-first.
- **8.2** Context + present model decision (SDL GL window vs pbuffer
  composite) per platform; headless pbuffer lane for CI either way.
- **8.3** webgl2-context port (overload strategy and getParameter typing
  decided by early compile experiments; binding-tracking design carries
  over verbatim).
- **8.4** Conformance: webgl-node's test scenarios run under
  Node+webgl-node vs the scriptc build; identical readback hashes.
  Khronos WebGL2 conformance subset as a stretch lane.

### Acceptance gate

Readback-hash parity across the scenario suite; a textured-cube example
at 60fps vsync on Linux; headless lane green in CI.

---

## Phase 9: threeTS-lite (10 days) [post-Phase 8]

Full spec: `docs/WEBGL-AND-3D.md`. Summary: a three-shaped (NOT
three-compatible: the gtlua rule in 3D) game-sized 3D library written
from scratch in the dialect against the WebGL2 tier: math, Object3D/
Scene/cameras, BufferGeometry with concrete attribute classes, forward
renderer with feature-bit program cache, Basic/Lambert/Standard-lite
materials, four light types, Mesh/InstancedMesh/Sprite/Line/Points,
textures + render targets, build-time glTF baking to a static binary
format (npm glTF parsers stay on the build machine). ~12-15k lines;
largest single work item in the project. three.js is the MIT-licensed
behavioral reference; no upstream TS source exists to port.

### Entry criteria

Phase 8 green, 0.9 accessor answer applied, v0.1 API stable.

### Tasks

- **9.1** math/ + core/ with unit tests ported from three's own suites
  where shapes allow.
- **9.2** renderer/ + materials/ + lights/ (feature-bit shader templates,
  GLSL 300 es).
- **9.3** objects/ + textures/ + render targets; asset bake tool
  (plain-JS, build-side) + runtime loader.
- **9.4** `examples/spinfield/` benchmark (10k cubes, instanced +
  non-instanced) head-to-head vs Node + three.js + webgl-node on the same
  machine; two playable 3D examples.

### Acceptance gate

Benchmark frame-time parity or better vs the Node stack; a playable 3D
example on all Linux targets; startup/memory numbers published in the CI
report table.

---

## Timeline summary

| Phase | Days | Gate? |
| --- | --- | --- |
| 0 toolchain spike | 1 | KILL gate |
| 1 window PoC | 2 | KILL gate |
| 2 canvas 2D | 5 | |
| 3 input | 2 | |
| 4 audio | 5 | |
| 5 framework + DX | 4 | |
| 6 cross + CI | 3 | |
| **total to v0.1 (2D)** | **~22** | |
| 8 WebGL2 tier | 6 | conformance gate |
| 9 threeTS-lite | 10 | benchmark gate |
| **total to v0.2 (3D)** | **~38** | |

Phases 2/3/4 are independent after Phase 1 and can run in parallel if
multiple agents are on it (they share only the shim's core tables and the
codegen, both Phase 2.1 outputs; run 2.1 first). Phase 8 depends only on
Phases 0/1 technically, but ships after v0.1 so the 2D surface stabilizes
first; Phase 9 strictly follows Phase 8.
