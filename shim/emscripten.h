/* Stand-in for <emscripten.h> when building webaudio-node's C++ core natively.
 *
 * The audit (docs/SPIKE-RESULTS.md, Phase 4) found that the engine uses
 * NOTHING from emscripten except the EMSCRIPTEN_KEEPALIVE attribute: no
 * EM_ASM, no EMSCRIPTEN_BINDINGS, no emscripten_* calls anywhere in 6,641
 * lines. KEEPALIVE only tells the WASM linker not to strip an export, which
 * a native static archive expresses as default visibility.
 *
 * Supplying this header instead of patching 24 files keeps the vendored
 * source BYTE-IDENTICAL to upstream, so a webaudio-node bump is a re-fetch
 * rather than a re-patch, and the parity test compares the same code.
 */
#ifndef SG_EMSCRIPTEN_SHIM_H
#define SG_EMSCRIPTEN_SHIM_H

#define EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default"), used))

#endif /* SG_EMSCRIPTEN_SHIM_H */
