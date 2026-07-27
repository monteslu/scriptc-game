declare function notBound(v: number): number;
function main(): void { const a = notBound(21); console.log(`a=${a}`); }
main();
