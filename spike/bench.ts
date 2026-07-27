declare function sgF64(v: number): number;

function main(): void {
  const N = 10000000;
  // warmup
  let w = 0;
  for (let i = 0; i < 100000; i++) { w += sgF64(1); }
  const t0 = Date.now();
  let sum = 0;
  for (let i = 0; i < N; i++) { sum += sgF64(1); }
  const t1 = Date.now();
  const ms = t1 - t0;
  const nsPerCall = (ms * 1000000) / N;
  console.log(`warm=${w} sum=${sum} ${N} calls in ${ms}ms = ${nsPerCall} ns/call`);
}

main();
