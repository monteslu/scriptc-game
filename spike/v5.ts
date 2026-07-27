declare function sgF64(v: number): number;
function f(v: number): number { const r = sgF64(v); return r; }
function main(): void { console.log(f(21)); }
main();
