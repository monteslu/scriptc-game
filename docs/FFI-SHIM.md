# The FFI Shim: Specification

The shim (`shim/`, builds to `libsgshim.a`) is the only new native code in
the project. It adapts three pointer-and-struct C/C++ APIs (skia_c, SDL2,
the webaudio-node core) to scriptc FFI format 1, whose entire vocabulary is:

- params: `f64`, `bool`, `u8`, `u32`, `i32`, `string` (in), `bytes` (in)
- returns: `f64`, `bool`, `u8`, `u32`, `i32`, `void`
- `string`/`bytes` arrive as `const uint8_t*, size_t`, **borrowed for the
  duration of the call only**, and native code must not mutate, free, or
  retain them
- no callbacks, no varargs, no struct-by-value, no pointer returns, no
  dlopen, no unwinding across the boundary

## Ground rules (all shim code)

1. **Never retain a borrowed pointer.** Anything from a `bytes`/`string`
   param that must outlive the call is memcpy'd into shim-owned storage
   inside the call (e.g. decode sources, audio command payloads).
2. **Never unwind.** The shim compiles with `-fno-exceptions` where possible;
   C++ regions (skia_c is C++ under an extern "C" surface) wrap calls that
   can throw in try/catch-to-status. No exception, longjmp, or abort crosses
   into scriptc-emitted code. (Native `abort()` on truly unrecoverable
   states is acceptable and documented; it is process death either way.)
3. **Every fallible call returns a status** (`i32`: 0 ok, negative error)
   or a handle (`u32`: 0 invalid). Error detail goes to the string mailbox.
4. **Main-thread-only** except the audio thread's private world. No shim
   global is touched by both threads except the SPSC ring and a few atomics
   (documented per-variable in `sg_audio.c`).
5. **All symbols prefixed** `sg_` (shim) / `wa_` (audio engine exports) to
   keep manifests greppable and avoid collisions in the static link.

## Handle tables

```c
typedef struct { void*    ptr;   // NULL when free
                 uint32_t gen;   // bumped on free, 8 bits used
               } sg_slot;

typedef struct { sg_slot* slots; uint32_t cap, count;
                 uint32_t free_head; /* free-list threaded through ptr */ }
        sg_table;

// handle layout: (gen & 0xFF) << 24 | (index & 0xFFFFFF); 0 == invalid
```

- `sg_table_alloc(table, ptr) -> u32 handle`
- `sg_table_get(table, handle) -> void*` returns NULL on stale gen or bad
  index; callers convert that to status `SG_EBADHANDLE` + mailbox message.
- One static table per domain: `T_SURFACE, T_CANVAS, T_PAINT, T_PATH,
  T_SHADER, T_IMAGE, T_BITMAP, T_FONT, T_TYPEFACE, T_MATRIX, T_PICTURE,
  T_ANODE, T_ABUF, T_APARAM`.
- `sg_debug_count(domain: u32) -> u32` and
  `sg_debug_high_water(domain: u32) -> u32` for leak tests.
- 24-bit index = 16.7M live objects per domain; a game that exceeds this has
  other problems. 8-bit gen wraps; combined with free-list LIFO reuse this
  is a debugging aid, not a security boundary, which is fine: the only
  writer of handles is our own runtime.

## Marshalling patterns

### Opaque pointers -> handles

```c
// skiac: skiac_paint* skiac_paint_create(void);
uint32_t sg_paint_create(void) {
  return sg_table_alloc(&T_PAINT, skiac_paint_create());
}
void sg_paint_destroy(uint32_t h) {            // idempotent
  void* p = sg_table_take(&T_PAINT, h);        // NULL if stale
  if (p) skiac_paint_destroy(p);
}
```

### Struct params -> flattened scalars

skia_c passes small structs (rects, points, transforms) by pointer. The shim
flattens to positional f64s:

```c
// skiac_canvas_draw_rect(canvas, float x, y, w, h, paint) variant depends
// on the actual header; where a struct* is required the shim builds it on
// the stack from scalars:
int32_t sg_canvas_draw_rect(uint32_t hc, double x, double y,
                            double w, double h, uint32_t hp);
```

Six-element transforms and nine-element matrices go as six/nine f64 params
(under clang's 8-integer/8-float register ABI this stays in registers on
x86_64 and arm64; no memory traffic).

### Bulk data in -> bytes

Pixels (putImageData), path data batches, audio sample uploads, decode
sources: one `bytes` param + explicit width/height/stride/format scalars.
The shim copies or consumes within the call. TS side passes
`new Uint8Array(f32.buffer, byteOffset, byteLength)` views to avoid copies
on the TS side (Phase 0.4 verifies this compiles; fallback is an explicit
copy helper).

### Data out -> three patterns, chosen per API

1. **Scalar getters** (preferred): `sg_evt_i32(field)`,
   `wa_analyser_bin(node, i) -> f64`, `sg_image_width(h) -> u32`.
   Used when values are few or access is sparse.
2. **String mailbox**: single static `char buf[4096]` + `sg_str_len()` /
   `sg_str_byte(i)`. Overwritten by each producing call; TS drains
   immediately. Used for error text, names, `sg_version()`.
3. **Native-side sinks**: data that would be large never crosses at all.
   `sg_surface_save_png(h, path: string) -> i32` writes the file itself;
   present() blits internally; audio renders internally. `getImageData` is
   the one API where the web shape demands bulk readback; it is implemented
   as `sg_readback_begin(h, x, y, w, h) -> i32` + `sg_readback_u32(i) -> u32`
   (one pixel per call) and documented as a debug-tier API.

### Errors

```c
#define SG_OK 0
#define SG_EBADHANDLE  -1
#define SG_ESDL        -2   // detail: SDL_GetError() -> mailbox
#define SG_ESKIA       -3
#define SG_EAUDIO      -4
#define SG_EDECODE     -5
#define SG_ERANGE      -6
```

TS wrapper policy: framework-internal calls check status and `throw new
Error(readMailbox())` (scriptc user throws are fully catchable). Hot-path
draw calls in release builds skip the check when the only failure mode is a
bad handle that our own runtime cannot produce (measured decision, Phase 2).

## The manifest(s)

Split by domain for reviewability; concatenated by the build script into the
single `ffi.json` scriptc consumes (verify in Phase 0 whether multiple
`--ffi` flags are supported; else concatenate):

```
ffi/core.ffi.json     # sg_init, present, events, ticks, mailbox, debug
ffi/skia.ffi.json     # generated
ffi/audio.ffi.json    # wa_*
```

Example entries:

```json
{
  "ffi_format": 1,
  "functions": [
    { "name": "sgCanvasDrawRect", "symbol": "sg_canvas_draw_rect",
      "params": ["u32","f64","f64","f64","f64","u32"], "returns": "i32" },
    { "name": "sgPutImageData", "symbol": "sg_put_image_data",
      "params": ["u32","bytes","u32","u32","i32","i32"], "returns": "i32" }
  ],
  "libraries": [
    "../vendor/<target>/libsgshim.a",
    "../vendor/<target>/libwebaudio.a",
    "../vendor/<target>/libcanvas-skia/*.a",
    "../vendor/<target>/libSDL2.a"
  ],
  "system_libraries": ["m", "pthread", "dl", "stdc++"]
}
```

(Exact `libraries` glob behavior and the C++ stdlib linking story are Phase
0/1 verification items; Skia needs libstdc++ or libc++ per target, SDL on
Linux needs its usual dlopen-based driver loading which pulls `dl` even in
static builds.)

Manifest rule reminders that bit us in design:

- The binding applies only to a **direct call of the exact declaration**:
  no `const f = sgCanvasDrawRect` aliasing in the runtime, no passing FFI
  functions as values. The runtime wraps every FFI function in a normal TS
  function/method immediately, and only those wrappers are exported.
- Binding names and symbols must be globally unique across the merged
  manifest; the generator enforces this.

## Codegen (`codegen/`, plain JS ESM)

One source of truth: `skia_c.hpp` (pinned via CANVAS_VERSION) plus
`codegen/overrides.json` + `codegen/events.json`.

`gen-shim.js` emits:

1. `shim/sg_skia_gen.c`: flattened wrappers for the allowlisted subset of
   the 237 skiac functions (allowlist lives in `overrides.json`; not all
   237 are needed for v1: skottie/pdf/svg/document families are Phase 7).
2. `ffi/skia.ffi.json`.
3. `runtime/canvas/ffi.d.ts`: the `declare function` block, names matched
   1:1 to the manifest.
4. `runtime/input/events.ts` + `shim/sg_events_gen.h`: the shared event
   field-index enums from `events.json`.

Generator behavior:

- Parses the extern "C" block with a deliberately dumb tokenizer (the
  header is machine-regular); any signature it cannot classify goes to a
  `NEEDS_OVERRIDE` report instead of guessing.
- Classification rules: `T*` first param -> handle of domain T; `float`/
  `double`/int params -> scalars; `const uint8_t* + size_t` pair -> bytes;
  struct-by-pointer out-params -> forces override entry (hand-written
  wrapper); pointer return -> handle alloc in the named domain.
- Regenerated in CI; a dirty diff against the committed generated files
  fails the build (same discipline as any generated-code repo).

## Shim source layout

```
shim/
  sg_core.c        # init/quit, window, renderer, present, ticks, mailbox
  sg_tables.c/.h   # handle table machinery
  sg_events.c      # poll + event slot + getters (includes sg_events_gen.h)
  sg_skia_gen.c    # GENERATED, do not edit
  sg_skia_extra.c  # hand-written overrides (string returns, readback, text)
  sg_audio.c       # device, thread, SPSC ring, wa_* forwarding
  sg_gamepad.c     # SDL_GameController open/close/state/rumble/mappings
  sg_image.c       # decode entry points over Skia codecs
```

Total hand-written C estimate: 1200-1800 lines. Generated: proportional to
the allowlist (~150 functions for v1 canvas).

## Performance notes

- FFI calls are direct C calls (no engine at the boundary per scriptc's
  docs); Phase 0.3 measures the real number. Budget math for a heavy 2D
  frame: ~500 draw calls x ~6 scalar args, plus ~50 state calls. Even at a
  pessimistic 100ns/call that is 55µs of boundary cost against a 16.6ms
  frame: 0.3%. This is why no command buffer exists in v1.
- The present memcpy is the only per-frame bulk cost (see ARCHITECTURE.md).
- `f64` params for what Skia wants as `float` cost one cvtsd2ss each; noise.
- Handle-table lookups are an array index + gen compare; noise.

## Security/robustness stance

The shim is a trust boundary in one direction only: our own TS runtime is
the only caller, so the threat model is bugs, not adversaries. Still:
every handle is gen-checked, every index is range-checked, borrowed spans
are length-respected (embedded NULs legal), and the whole thing runs under
ASan in the host-lane CI job (scriptc's own `--sanitize` lane covers the
scriptc side; the shim's unit tests run ASan natively without scriptc).
