declare function sgF64(v: number): number;
function main(): void {
  const a = sgF64(1); const b = sgF64(2); const arr: number[] = [sgF64(4)];
  const o = { v: sgF64(5) }; const c = sgF64(6) > 0;
  console.log(`${a} ${b} ${arr[0]} ${o.v} ${c}`);
}
main();
