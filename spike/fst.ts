import { readFileSync } from "fs";
declare function sgBytesSum(b: Uint8Array): number;
function main(): void {
  const buf = readFileSync("/tmp/claude-1000/-home-monteslu-code-cliemu/f66d9a4b-6f77-4048-a9d6-12f07dba9512/scratchpad/asset.bin");
  let sum = sgBytesSum(buf); sum += 0;
  console.log(`read ${buf.length} bytes, sum=${sum}`);
}
main();
