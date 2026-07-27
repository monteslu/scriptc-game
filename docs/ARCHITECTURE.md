# Architecture

## Layer diagram

```
+---------------------------------------------------------------+
|  game code (TS, scriptc static dialect)                       |
|     examples/*, user projects                                 |
+---------------------------------------------------------------+
|  runtime/ (TS, compiled statically by scriptc)                |
|     canvas/Context2D   audio/AudioContext+nodes               |
|     input/keyboard+mouse+Gamepad   loop/run+timing            |
|     assets/loader   color/css-parse   handles (u32 wrappers)  |
+---------------------------------------------------------------+
|  declare function sg_* / wa_* (FFI declarations, no bodies)   |
|  ffi/*.ffi.json manifests (ABI authority)                     |
+======================= C ABI boundary ========================+
|  shim/ (C, one static archive: libsgshim.a)                   |
|     handle tables    event slot + getters   string mailbox    |
|     sg_skia_gen.c (generated)   sg_sdl.c   sg_audio.c         |
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

```
sg.run(opts) [TS]:
  sg_init(w, h, flags)
  last = sg_ticks()                      // SDL performance counter, ms as f64
  acc = 0
  while (running):
    while ((t = sg_poll_event()) != 0):  // drain event queue
      dispatch(t, scalar getters...)     // updates input state maps
    now = sg_ticks(); acc += now - last; last = now
    while (acc >= STEP):                 // fixed-timestep update
      opts.update(STEP); acc -= STEP
    opts.draw(ctx, acc / STEP)           // interpolation factor
    sg_present()                         // blocks on vsync
```

- No requestAnimationFrame emulation. The loop is explicit and owned by the
  framework (the jsgame-libretro lesson: the frame contract must be the
  platform's, not the browser's).
- `sg_present()` with PRESENTVSYNC is the pacing source. A
  `sg_set_vsync(0)` escape hatch exists for benchmarks.
- scriptc async/fibers are allowed in game code (e.g. load screens) but the
  frame loop itself is synchronous; FFI calls are synchronous by contract.

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
- No DOM, no requestAnimationFrame, no window object pretense. The API is
  web-shaped where the shape helps (Context2D, AudioNode graph, Gamepad),
  and honest platform API everywhere else (`sg.run`, `sg.assets`).
- No quickjs island, ever, in this project. If a build needs `--dynamic`,
  something is wrong; CI builds without it and treats its presence as an
  error.
- No npm dependencies in the runtime. The runtime is self-contained TS; the
  dialect makes most utility packages uncompilable anyway.
