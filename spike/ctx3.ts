declare function sgF64(v: number): number;
function main(): void { const o = { v: sgF64(5) }; console.log(o.v); }
main();
