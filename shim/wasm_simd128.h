/* Stand-in for <wasm_simd128.h> when building webaudio-node natively.
 *
 * Two engine files (webaudio.cpp, buffer_source_node.cpp) include this
 * header UNCONDITIONALLY even though every use of it is correctly guarded by
 * `#ifdef __wasm_simd128__`. Compiling for x86_64 or arm64 never defines that
 * macro, so the guarded blocks vanish and the header's contents are never
 * referenced -- but the include itself still has to resolve, and clang's real
 * wasm_simd128.h explodes off-target because its builtins do not exist.
 *
 * An empty header is therefore exactly right: it satisfies the include and
 * contributes nothing. As with shim/emscripten.h, this keeps the vendored
 * source byte-identical to upstream so a bump is a re-fetch, not a re-patch.
 *
 * The cost is that the engine's SIMD paths are unavailable natively and the
 * scalar fallbacks (which the same #ifdefs select) run instead. Those are the
 * paths the WASM build uses without -msimd128, so they are well travelled.
 * Native SIMD would mean adding SSE/NEON branches upstream, which is a real
 * contribution rather than a port detail; noted for later if audio ever shows
 * up in a profile.
 */
#ifndef SG_WASM_SIMD128_SHIM_H
#define SG_WASM_SIMD128_SHIM_H
#endif
