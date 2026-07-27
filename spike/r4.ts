declare function sgF64(v: number): number;
function get(v: number): number { return sgF64(v); }
function main(): void { console.log(get(21)); }
main();
