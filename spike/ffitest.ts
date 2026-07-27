declare function sgF64(v: number): number;
declare function sgBool(v: boolean): boolean;
declare function sgU8(v: number): number;
declare function sgU32(v: number): number;
declare function sgI32(v: number): number;
declare function sgVoid(v: number): void;
declare function sgStrSum(s: string): number;
declare function sgBytesSum(b: Uint8Array): number;
declare function sgBytesAsF32(b: Buffer, idx: number): number;

function main(): void {
  console.log(`f64: ${sgF64(21)}`);
  console.log(`bool: ${sgBool(false)}`);
  console.log(`u8: ${sgU8(254)}`);
  console.log(`u32: ${sgU32(1000)}`);
  console.log(`i32: ${sgI32(-5)}`);
  sgVoid(1);
  console.log(`str: ${sgStrSum("AB")}`);
  const u = new Uint8Array(4);
  u[0] = 1; u[1] = 2; u[2] = 3; u[3] = 4;
  console.log(`bytes: ${sgBytesSum(u)}`);

  // Phase 0.4: Float32Array viewed as bytes (the bulk-upload path)
  const f = new Float32Array(3);
  f[0] = 1.5; f[1] = 2.5; f[2] = -3.25;
  const view = Buffer.from(f.buffer, 0, 12);
  console.log(`f32view[0]: ${sgBytesAsF32(view, 0)}`);
  console.log(`f32view[2]: ${sgBytesAsF32(view, 2)}`);
}

main();
