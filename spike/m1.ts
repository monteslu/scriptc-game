declare function sgF64(v: number): number;
declare function sgU32(v: number): number;
function main(): void {
  const a = sgF64(21);            // was FAILING
  let b = sgF64(1); b += 1;
  const u = sgU32(1000);          // was FAILING
  const o = { v: sgF64(5) };
  const arr: number[] = [sgF64(4)];
  console.log(`a=${a} b=${b} u=${u} o=${o.v} arr=${arr[0]} direct=${sgF64(2)}`);
}
main();
