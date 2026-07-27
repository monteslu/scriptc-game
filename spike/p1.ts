declare function sgF64(v: number): number;
function main(): void { let a = sgF64(21); console.log(`a=${a}`); }
function unused(): void { const b = sgF64(1); console.log(b); }
main();
