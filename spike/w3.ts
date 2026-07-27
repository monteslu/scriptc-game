declare function sgF64(v: number): number;
function main(): void { let t = 0; for (let i = 0; i < 3; i++) { const x = sgF64(i); t += x; } console.log(t); }
main();
