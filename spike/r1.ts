declare function sgF64(v: number): number;
function main(): void { let a = sgF64(21); let b = a; b += 0; console.log(b); }
main();
