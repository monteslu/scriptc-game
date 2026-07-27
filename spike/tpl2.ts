declare function sgF64(v: number): number;
function main(): void {
  const a = sgF64(1);                       // 1. plain assignment
  const b = sgF64(2) + sgF64(3);            // 2. arithmetic
  const arr: number[] = [sgF64(4)];         // 3. array literal
  const o = { v: sgF64(5) };                // 4. object literal
  if (sgF64(6) > 0) { }                     // 5. condition
  const s = "x" + sgF64(7);                 // 6. string concat (non-template)
  console.log("all-direct ok");
  console.log(`${a} ${b} ${arr[0]} ${o.v} ${s}`);
}
main();
