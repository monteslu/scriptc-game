declare function sgThreadCount(u: number): number;
function main(): void { console.log(`count=${sgThreadCount(0)}`); }
main();
