# Build and CI

## Inputs and pins (`versions.json`)

```json
{
  "scriptc": "0.0.17",
  "canvas": "<CANVAS_VERSION from build-libcanvas>",
  "sdl": "2.30.x",
  "webaudio-node": "<git sha>",
  "zig": "0.13.x (cross lane only)"
}
```

Rules (house conventions):

- Upstream is FETCHED at pinned versions, never vendored into git.
- Any patch lives in `scripts/patches/<name>.patch` applied by the matching
  `scripts/build-<component>.sh`. Expected patch count for v1: zero
  (skia archives come prebuilt from build-libcanvas releases; SDL builds
  stock; webaudio-node changes land upstream in that repo, not as patches
  here, since monteslu owns it).
- scriptc is pinned exactly (0.0.x moves fast and the FFI manifest format
  is versioned data we depend on). Pin bumps are deliberate PRs that re-run
  the full conformance matrix and re-audit DIALECT.md.

## Per-target archive sets (`vendor/<target>/`)

Targets: `linux-x86_64`, `linux-aarch64`, `macos-aarch64`,
`macos-x86_64`, `windows-x86_64`.

| Archive | Source | Notes |
| --- | --- | --- |
| `libcanvas-skia/*.a` + `skia_c.hpp` | build-libcanvas GitHub releases | Already built per platform in that repo's CI, Ganesh GL included (unused until Phase 7). We do NOT link `libcanvas.a` (the Rust/napi crate): only the Skia archives + the header. Verify `skiac_*` symbols live in the Skia-side archives and not the Rust one; if they are implemented in the Rust staticlib, build-libcanvas grows a tiny additional artifact: `libskiac.a` compiled from `src/canvas/skia-c/*.cpp` alone (small CI change in that repo, flagged as Phase 1.1 discovery work). |
| `libSDL2.a` | SDL release source, `scripts/build-sdl.sh` | Static, subsystems: video, events, timer, joystick, gamecontroller, haptic, audio. Linux still dlopens display/audio drivers at runtime (its normal static behavior), hence `dl` in system_libraries. |
| `libwebaudio.a` | webaudio-node repo, `scripts/build-webaudio.sh` | clang -O2, plain native, includes dr_libs/stb_vorbis/fdk-aac. SIMD flags per arch (SSE4.2 / NEON). |
| `libsgshim.a` | this repo, `scripts/build-shim.sh` | Small; rebuilt constantly during dev. |
| `libsggl.a` | this repo, `scripts/build-gl.sh` | The GLES3 tier: generated bindings plus the hand-written shim (out-params, strings, bulk uploads, the EGL pbuffer). Linked only when a game's reachable declaration set uses GL, so a 2D game does not pull in libGLESv2. **Must be scripted, not hand-built**: it being built by hand and never scripted is what broke CI from Phase 8 until it was found. |
| `angle/lib/*` | `scripts/fetch-angle.sh` (macOS/Windows) | GLES3 via pinned ANGLE builds, following `native-gles`: kivy/angle-builder dylibs on macOS and mmozeiko/build-angle DLLs plus import libraries on Windows. macOS install names are rewritten after linking; Windows DLLs are staged beside each artifact. Linux uses system EGL/GLES. |
| `skia/icudtl.dat` | build-libcanvas release | Required by Skia text layout on Windows and staged beside the executable. |

**Link order is load-bearing**: `libsggl.a` comes BEFORE `libsggfx.a`, with
ANGLE between them on macOS and Windows. An archive is scanned once, left to right, so
the GL archive may call into the gfx archive but never the reverse.

`scripts/fetch-archives.sh <target>` populates `vendor/<target>/` from
pinned release URLs + local builds, and writes `vendor/<target>/MANIFEST`
with hashes. `vendor/` is gitignored BY NAME (never a global `build/`-style
ignore pattern; the gitignore-ate-vendored-source trap from romdev is why
this is called out).

## Build hosts and lanes

Each target builds on a matching native runner. Linux and macOS use native
clang. Windows runs on `windows-latest` and selects
`SCRIPTC_CC=zigcc SCRIPTC_TARGET=x86_64-windows-msvc`; this uses Zig as the
driver while consuming the runner's MSVC SDK and ABI-compatible native
archives. FFI archives are always target-specific and are never borrowed
from another matrix lane.

`scripts/build.sh <example|game-dir> <target>`:

```
1. node codegen/gen-shim.js --check        # generated files up to date
2. scripts/build-shim.sh <target>          # cc -> libsgshim.a
3. node codegen/merge-ffi.js <target>      # ffi/*.ffi.json -> .build/ffi.json
                                           #   (paths rewritten to vendor/<target>)
4. scriptc build <entry.ts> --ffi .build/ffi.json -o <out>
   [cross lane: SCRIPTC_CC=zigcc SCRIPTC_TARGET=<triple> prepended]
5. scriptc coverage <entry.ts> --ffi ... | node scripts/assert-fully-static.js
```

Step 5 enforces the invariant: 100% static, zero island, zero deferred
sites, or the build fails.

## CI (GitHub Actions shape)

### Job matrix

| Job | Runner | What |
| --- | --- | --- |
| `linux-x86_64` | ubuntu-24.04 | Build every example, run the full suite, report sizes, upload binaries |
| `linux-aarch64` | ubuntu-24.04-arm | Same |
| `macos-aarch64` | macos-14 | Same; ANGLE translates GLES3 to Metal |
| `macos-x86_64` | macos-15-intel | Same; ANGLE translates GLES3 to Metal |
| `windows-x86_64` | windows-latest | Same; MSVC ABI, SDL2/ANGLE DLLs and `icudtl.dat` staged with artifacts |

### Conformance details

- **Canvas goldens** are generated by `test/golden/gen.js` (plain JS,
  runs under Node with @napi-rs/canvas pinned to the same CANVAS_VERSION)
  and committed. The scriptc-built harness re-renders each scene headless
  and byte-compares. Same Skia version on both sides makes byte-equality
  the correct assertion; any diff is a marshalling bug by definition.
- **Audio hashes**: each graph scenario renders N seconds offline in
  (a) webaudio-node WASM under Node, (b) libwebaudio via a native test
  driver, (c) the full scriptc binary. SHA-256 over the sample buffer;
  all three must match.
- **Leak gate**: every conformance run ends by asserting
  `sg_debug_count(domain) == 0` for all domains after teardown, and RSS
  delta over a 5000-frame idle loop is < 1MB.

### Headless notes

`SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy` for conformance (no window,
no device). Present becomes a no-op blit into the streaming texture path
minus RenderPresent; the raster surface (what the goldens hash) is
unaffected. Real-window smoke happens in the arm64/windows smoke jobs only
if the runner has a display; otherwise dummy there too and real-window
testing stays a local-machine checklist item before releases.

**A 3D game needs `SG_HEADLESS=1`**, which is a different mechanism: it
renders into an EGL pbuffer and forces the dummy video driver itself. The
failure mode without it is not an error but a HANG -- `SDL_CreateWindow`
succeeds, the window is never mapped, and the process sits in `poll()` at
~0% CPU producing no output until it is killed. A CI job that merely times
out looks like a slow runner rather than a missing flag.

`SG_GL_DEVICE=<n>` pins the EGL device. `devices[0]` is whatever the driver
enumerates first, which on a machine with integrated and discrete graphics
may be the slower part; any benchmark that does not pin this is comparing
across GPUs without saying so.

## Packaging

Each matrix lane uploads its `build/` directory. Linux and macOS artifacts
contain native executables. Windows additionally carries `SDL2.dll`,
ANGLE's DLLs, and `icudtl.dat`; keep those files beside the executable.

The framework itself ships as a template repo (copy, not a package
registry dependency) in v1: scriptc resolves plain relative imports, the
runtime is small, and template-copy sidesteps npm-package-with-TS-source
questions until the scriptc ecosystem settles. Revisit at v0.2.
**Naming and any publishing: flag monteslu first, always.**

## Developer loop

`scripts/dev.sh <example>`: watch web/ + engine/ + host/ + example dir, on change re-run
build.sh (shim rebuild skipped unless shim/ changed) and relaunch the
binary. scriptc compile speed for a game-sized program is a Phase 1
measurement; if the edit-run loop exceeds ~3s, add `--emit-ir`-level
caching investigation to Phase 5.3 (scriptc keeps `.scriptc/` build
artifacts; unknown if incremental).
