declare function sgF64(v: number): number;
function main(): void {
  const direct = sgF64(21);
  console.log(`direct-then-interp: ${direct}`);
  console.log(`inline-in-template: ${sgF64(21)}`);
}
main();
