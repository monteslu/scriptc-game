# Architecture

## Layer diagram

```
+---------------------------------------------------------------+
|  game code -- BROWSER CODE (TS, scriptc static dialect)       |
|     document.getElementById  requestAnimationFrame            |
|     new Image()  fetch  AudioContext  navigator.getGamepads() |
|     examples/*, user projects                                 |
+---------------------------------------------------------------+
|  engine/ (OPTIONAL -- a game must be able to skip it)         |
|     sfx (oscillator effects), future helpers                  |
|     imports web/ like a game does; never reaches into host/   |
+---------------------------------------------------------------+
|  web/ (the browser surface -- all a game is allowed to see)   |
|     globals: document, window, navigator, rAF, Image, fetch,  |
|              FontFace, AudioContext, Math, Gamepad types      |
|     canvas/Context2D   audio/AudioContext+nodes               |
|     input/Gamepad+keycodes   canvas/color+font parsing        |
+---------------------------------------------------------------+
|  host/ (machinery; games never import this)                   |
|     runtime: the frame loop that drives rAF                   |
|     resources: game dir = web root, URL resolution            |
|     tasks: the one queue behind every async shim              |
|     ffi + skia-ffi: declarations   mailbox   math-over-libm   |
+---------------------------------------------------------------+
|  declare function sg_* / wa_* (FFI declarations, no bodies)   |
|  ffi/*.ffi.json manifests (ABI authority)                     |
+======================= C ABI boundary ========================+
|  shim/ (C/C++, merged into one archive: libsggfx.a)           |
|     handle tables    event slot + getters   string mailbox    |
|     sg_skia_gen.cpp (generated)  sg_skia_extra.cpp            |
|     sg_core.cpp (window/present)  sg_input.cpp                |
|     sg_audio.cpp (SDL device + SPSC ring)  sg_audio_decode    |
+---------------------------------------------------------------+
|  vendored static archives (per target, fetched, pinned)       |
|     skia/*.a (build-libcanvas)   libSDL2.a   libwebaudio.a    |
+---------------------------------------------------------------+
|  OS: display server / audio device / evdev etc. via SDL       |
+---------------------------------------------------------------+
```

Everything above the double line is compiled by scriptc into native code.
Everything below it is clang-compiled C/C++/Rust-free static archives linked
into the same executable by scriptc's link step (`libraries` in the manifest).

There is exactly one process, and (from scriptc's point of view) one thread.
The shim privately owns one additional native thread (audio). scriptc's
runtime never sees it.

## Why these seams

scriptc FFI format 1 constraints (the whole architecture flows from these):

| Constraint | Consequence |
| --- | --- |
| Param/return types: f64, bool, u8, u32, i32 (+ string/bytes IN only) | No pointers cross the boundary, ever. Opaque objects live shim-side in handle tables; TS holds u32 indices. |
| No string/bytes RETURNS | Strings come back via a mailbox + per-byte getters. Pixels/audio never come back at all (native-side sinks instead). |
| No callbacks | The framework owns the main loop; audio renders on a shim thread; events are polled. Nothing ever calls into TS. |
| No struct-by-value | Structs flatten to scalar args or ride in via bytes. |
| No dlopen | Everything static-links. One binary. |
| Synchronous calls only, no unwinding across | Shim never throws/longjmps; every call returns a status or a handle, errors go to the mailbox. |

## Handle tables

One table per object domain, all identical machinery (generated from a
template macro):

```
domains: surface, canvas, paint, path, shader, image, bitmap, font,
         typeface, matrix, picture, audio_node, audio_buffer, audio_param
```

- Table = growable array of `{void* ptr; uint32_t gen;}` + free list.
- Handle = `u32`, packed as `gen(8) | index(24)`. 0 is always invalid.
- Every `sg_*_destroy(h)` bumps `gen`, so a stale handle is detected, not a
  use-after-free: shim returns error status and sets the mailbox.
- `sg_debug_count(domain: u32) -> u32` live-object counters back the leak
  tests in CI.
- TS side wraps each domain in a class holding the u32 plus a `dispose()`;
  scriptc's deterministic refcounting means simple RAII-ish patterns work
  (dispose in `finally`, or rely on framework-managed lifetimes: the
  Context2D owns its paint/path pool and recycles them).

Rationale for gen-bits: scriptc's static tier cannot segfault, and the shim
must not reintroduce that class of bug through integer handles.

## Frame loop and timing

The HOST owns the loop and drives the game's `requestAnimationFrame`
callbacks, exactly as a browser drives a page. A game never sees this code.

```
host/runtime.ts:

  boot(opts):                            // BEFORE the game module evaluates
    sg_init(w, h, flags)                 // window exists, so `document` works
    sg_input_init()
    __initScreen()                       // build the canvas + document

  run(opts):
    __fireLoad()                         // 'load' fires once, before frame 1
    for (;;):
      input.pump()                       // drain SDL events + refresh pads
      __dispatchKeyEvents(); __dispatchMouseEvents()
      __drainTasks()                     // img.onload, fetch/promise settlement
      __runFrameCallbacks(sg_ticks())    // the game's rAF callbacks
      sg_present()                       // blocks on vsync: THIS is the pacer
```

- **requestAnimationFrame is real**, and it is a QUEUE, not a single slot:
  two independent systems registering in one frame both run, as in a browser.
  (jsgamelauncher keeps one pending callback and silently drops the second.)
- `sg_present()` with PRESENTVSYNC is the pacing source; `SG_NO_VSYNC` opts
  out for benchmarks.
- **Async is drained before the frame that observes it.** Everything
  async-shaped settles on a later turn through one queue (`host/tasks.ts`),
  so `img.onload` fires even when attached after `src`, and a flag it sets is
  not visible on the next line. Genuinely synchronous web APIs stay sync.
- Fixed-timestep integration, interpolation and delta clamping are the
  GAME's business now, not the platform's, which is how browser games work.
  `examples/dodge` shows the pattern.

## Present path

**v1 (CPU raster, Phases 1-6):**

```
SkSurface (raster, RGBA8888, shim-owned)
  -> sg_present():
       skiac peekPixels / surface data ptr        (shim-internal)
       SDL_UpdateTexture(streaming texture)        (one memcpy)
       SDL_RenderCopy + SDL_RenderPresent          (GPU blit + vsync)
```

One full-frame copy per frame. At 1280x720 RGBA that is ~3.7MB/frame,
~220MB/s at 60fps: trivial for any modern memory bus, acceptable through
1080p. Measured in Phase 1; revisited only if profiles say so.

**v2 (GPU, Phase 7):** Ganesh GL-backed SkSurface created against an SDL GL
context (the GPU-surface C API exists via build-libcanvas's
`ganesh-gpu.patch`); `sg_present()` becomes flush + SwapWindow. Zero-copy.
Platform GL dialect must match Skia's `skia_gl_standard` per the
build-libcanvas README warning.

## Event protocol

SDL events are structs; structs cannot cross. The shim keeps ONE static
event slot (main-thread-only access makes this race-free):

```
sg_poll_event() -> u32        // 0 = queue empty, else event type enum
sg_evt_i32(field: u32) -> i32 // scancode, button, x, y, window id...
sg_evt_f64(field: u32) -> f64 // wheel precise, axis normalized...
sg_evt_text_len() -> u32      // TEXTINPUT only
sg_evt_text_byte(i: u32) -> u32
```

Field indices are a documented enum shared between shim and TS (generated
into both from one JSON description in `codegen/`). Cost: 2-5 FFI calls per
event; event rates are tens per frame; negligible at direct-call prices.

## String mailbox

For the rare native-to-TS strings (errors, controller names, font family
names):

```
sg_str_len() -> u32
sg_str_byte(i: u32) -> u32
```

Any shim call that produces a string writes it to the mailbox first and
returns a status; TS drains via a helper (`readMailbox(): string`) that
builds the string from UTF-8 bytes. O(n) FFI calls per string, n is small,
frequency is low. Not used for anything per-frame.

## Audio threading model

```
main thread (scriptc)                    audio thread (shim-owned)
---------------------                    -------------------------
wa_* FFI calls
  -> encode command                       SDL audio callback fires
  -> push to SPSC ring  ---------------->   drain command ring at
     (lock-free, shim                        quantum boundary
      allocates all storage)                 render 128-frame quantum
                                             through webaudio graph
sg_audio_time() -> f64  <----------------  publish currentTime
  (atomic read)                              (atomic store)
```

- Commands are fixed-size POD records (create node, connect, schedule param,
  start source...). The webaudio-node C++ core already runs its whole graph
  in native code with sample-accurate `current_sample` counters; this reuses
  that design with the JS/WASM glue replaced by the ring.
- decodeAudioData runs ON the main thread inside the FFI call (native
  decode is fast); the resulting AudioBuffer lives shim-side as a handle.
  Nothing audio ever crosses back except scalars (currentTime, analyser
  bins by index).
- The audio thread never touches scriptc memory, never calls FFI, never
  throws. It is invisible to scriptc, which the Phase 0.6 spike verifies is
  tolerated.

## Asset pipeline

- Runtime loading (default): `fs.readFileSync` (scriptc static fs) ->
  `Uint8Array` -> bytes param -> shim decodes (Skia codecs for
  png/jpg/webp; dr_libs/stb_vorbis/fdk-aac for audio) -> handle.
  Assets ship in an `assets/` directory next to the binary; the loader
  resolves relative to `process.argv[1]` (the binary path per scriptc's
  documented process shape).
- Build-time baking (opt-in): `comptime()` for small structured data
  (atlas frame maps, key bindings, controller DB extras). Large binary
  blobs stay runtime-loaded to keep compile times sane; revisit if a
  true single-file mode is demanded (then: appended pak section read via
  fs from the binary's own path).

## The 3D tier (Phase 8/9 roadmap; full spec in WEBGL-AND-3D.md)

Sits beside the canvas tier, not on top of it:

```
game code -> threeTS-lite (Scene/Mesh/materials, dialect TS)
          -> WebGL2RenderingContext-shaped class (webgl-node port, TS)
          -> gl* FFI declarations -> libEGL/libGLESv2 (system_libraries)
                                     + ~600-line GL shim (out-params,
                                       logs, readback sinks, GLsync)
```

Architectural notes that differ from the canvas tier:

- **No handle tables** for GL objects: GL names are already u32. Only
  GLsync (a pointer type) gets a table. Most scalar-only GL functions
  bind manifest-direct with zero shim involvement.
- **Present**: preferred model is an SDL GL window (context via
  SDL_GL_CreateContext, SwapWindow vsync), with the 2D canvas HUD
  uploaded as a GL texture per frame (bytes IN direction). The
  EGL-pbuffer model (native-gles's `egl_context.cpp`, which is
  N-API-free and compiles into the shim unchanged) serves headless CI
  and the future Skia-Ganesh GPU composite.
- **Uniform/attribute uploads** ride the same Float32Array-as-bytes path
  as putImageData (Phase 0.4 spike governs both tiers).

## What is deliberately NOT here

- No WebGL/3D tier in v0.1; it arrives as Phases 8/9 per the section
  above rather than growing ad hoc.
- No DOM tree. `document.getElementById` returns THE canvas whatever id it is
  given, and `querySelectorAll` has no meaning here; there is nothing to
  query. This is the same shortcut jsgamelauncher takes, for the same reason.
- No invented API where a spec exists. If the web defines it, we match it
  (and cite the spec at the site); if the web does NOT define it -- the
  Standard Gamepad names no `BTN_A` constant, we do not invent a global for
  it either. Conveniences live in `engine/`, which is optional.
- No quickjs island, ever, in this project. If a build needs `--dynamic`,
  something is wrong; CI builds without it and treats its presence as an
  error.
- No npm dependencies in the runtime. The runtime is self-contained TS; the
  dialect makes most utility packages uncompilable anyway.
