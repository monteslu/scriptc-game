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

Targets: `linux-x86_64`, `linux-arm64`, `macos-arm64`, `windows-x86_64`.

| Archive | Source | Notes |
| --- | --- | --- |
| `libcanvas-skia/*.a` + `skia_c.hpp` | build-libcanvas GitHub releases | Already built per platform in that repo's CI, Ganesh GL included (unused until Phase 7). We do NOT link `libcanvas.a` (the Rust/napi crate): only the Skia archives + the header. Verify `skiac_*` symbols live in the Skia-side archives and not the Rust one; if they are implemented in the Rust staticlib, build-libcanvas grows a tiny additional artifact: `libskiac.a` compiled from `src/canvas/skia-c/*.cpp` alone (small CI change in that repo, flagged as Phase 1.1 discovery work). |
| `libSDL2.a` | SDL release source, `scripts/build-sdl.sh` | Static, subsystems: video, events, timer, joystick, gamecontroller, haptic, audio. Linux still dlopens display/audio drivers at runtime (its normal static behavior), hence `dl` in system_libraries. |
| `libwebaudio.a` | webaudio-node repo, `scripts/build-webaudio.sh` | clang -O2, plain native, includes dr_libs/stb_vorbis/fdk-aac. SIMD flags per arch (SSE4.2 / NEON). |
| `libsgshim.a` | this repo, `scripts/build-shim.sh` | Small; rebuilt constantly during dev. |

`scripts/fetch-archives.sh <target>` populates `vendor/<target>/` from
pinned release URLs + local builds, and writes `vendor/<target>/MANIFEST`
with hashes. `vendor/` is gitignored BY NAME (never a global `build/`-style
ignore pattern; the gitignore-ate-vendored-source trap from romdev is why
this is called out).

## Build hosts and lanes

scriptc's compiler is an npm package (Node program driving clang); primary
documented host is macOS arm64; static programs cross-compile with
`SCRIPTC_CC=zigcc SCRIPTC_TARGET=<triple>`. We never use `--dynamic`
(which is host-native only), so every target is reachable from any host
that runs scriptc itself.

Two lanes, so no single host type is a dependency:

1. **Native lane** (preferred when available): build on a runner matching
   the target. linux-x86_64 runner builds linux-x86_64, etc. Phase 0.1
   establishes whether scriptc runs on Linux hosts; expectation is yes
   (no `os` restriction in the npm package, needs only Node + clang).
2. **Cross lane** (documented-supported): macos-arm64 runner + zig builds
   linux-x86_64, linux-arm64, windows-x86_64. FFI archives do not
   translate across targets, so the cross lane consumes the SAME
   `vendor/<target>/` sets the native lane does. This lane is the fallback
   if 0.1 says Linux hosting is broken, and the only lane for windows
   until someone cares enough to test scriptc-on-Windows-host.

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
| `shim-unit` | ubuntu | Shim unit tests native + ASan (no scriptc involved): handle tables, event slot, ring buffer, decode entry points |
| `build-linux-x64` | ubuntu | Native lane full build, all examples |
| `conformance-linux-x64` | ubuntu | Headless canvas goldens + audio hashes + leak counters (SDL dummy video/audio drivers) |
| `build-macos-arm64` | macos-14 | Native macOS build + cross-compile linux-arm64 & windows-x64 artifacts |
| `smoke-linux-arm64` | ubuntu-arm | Run cross-built arm64 artifacts + conformance |
| `smoke-windows` | windows | Run cross-built exe: boots, renders 100 frames headless, exits 0 |
| `report` | ubuntu | Size/startup table per example per target, appended to a tracked CSV; regression thresholds fail the job |

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

## Packaging

Per-game artifact = the binary + `assets/` directory, zipped per target.
No installer, no runtime deps (verified by the clean-machine smoke:
container `FROM scratch`-adjacent image for Linux jobs, `ldd` output
recorded; expected: libc, libm, libpthread, libdl, libstdc++ family only).

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
