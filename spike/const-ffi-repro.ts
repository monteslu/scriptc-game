// Repro: an FFI-bound call is dropped when its result initializes a local
// that is never reassigned.
//
// Build:
//   clang -O2 -c native.c -o native.o && ar rcs libnative.a native.o
//   scriptc build const-ffi-repro.ts --ffi ffi.json -o repro
//   ./repro
//
// Expected: 42
// Actual:   Uncaught ReferenceError: sgF64 is not defined   (exit 1)
//
// The build succeeds with no diagnostic. The failure is at program load, not
// at the statement: nothing prints at all. In the emitted IR there is no
// `call double @sg_f64`; the reference lowers to `scr_undef_global_read`,
// i.e. the name resolved as an undefined global instead of as the FFI
// declaration the manifest binds.
//
// The trigger is single assignment, NOT the const keyword:
//
//   let a = sgF64(21); console.log(a);            // FAILS
//   const a = sgF64(21); console.log(a);          // FAILS
//   let a = sgF64(21); a += 1; console.log(a);    // works
//   console.log(sgF64(21));                       // works (no binding)
//   function f(v){ return sgF64(v); }             // works (no binding)
//   const o = { v: sgF64(5) }; console.log(o.v);  // works
//   let s = 0; s += sgF64(7);                     // works
//
// So any local that holds an FFI result and is never reassigned loses the
// call. Making the argument non-constant does not help (`let n = 20; n += 1;
// const a = sgF64(n)` still fails), which points at the binding's
// initializer being propagated rather than at argument folding.
//
// Affects every ABI class (f64, u32, ... alike) and every scope tried (top
// level, nested function, loop body).
//
// scriptc 0.0.17, Linux x86_64, clang 21.1.8, LLVM backend (default).
// Also reproduces with --backend c.

declare function sgF64(v: number): number;

function main(): void {
  const viaConst = sgF64(21);
  console.log(`const: ${viaConst}`); // never reached; nothing prints
}

main();
