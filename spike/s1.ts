declare function sgF64(v: number): number;
declare function sgU32(v: number): number;

// Workaround shape: FFI results flow through class fields / mutated locals,
// never a single-assignment local. This is what the runtime wrappers do.
class Handle {
  id = 0;
  constructor(seed: number) { this.id = sgU32(seed); }   // field assignment
}

function scale(v: number): number { return sgF64(v); }   // direct return

function main(): void {
  const h = new Handle(1000);           // const holding a CLASS, not an FFI scalar
  console.log(`handle=${h.id}`);
  console.log(`scale=${scale(21)}`);
  // accumulate pattern
  let total = 0;
  for (let i = 0; i < 5; i++) { total += sgF64(i); }
  console.log(`total=${total}`);
  // array store pattern
  const out: number[] = [];
  for (let i = 0; i < 3; i++) { out.push(sgF64(i)); }
  console.log(`out=${out[0]},${out[1]},${out[2]}`);
}
main();
