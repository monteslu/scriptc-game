/* The polymorphic call shapes webgl2-context.mjs uses.
 *   bufferData(target, sizeOrData, usage)  -- number OR typed array
 *   texImage2D(target, level, fmt, ...rest) -- 6-arg and 9-arg forms
 * Both must work, or the port needs a different API shape. */

class Ctx {
  // A union param: the spec really is number | ArrayBufferView | null.
  bufferData(target: number, sizeOrData: number | Uint8Array | null, usage: number): void {
    if (sizeOrData === null) { console.log("bufferData: null"); return; }
    if (typeof sizeOrData === "number") {
      console.log(`bufferData: size ${sizeOrData}`);
      return;
    }
    console.log(`bufferData: ${sizeOrData.length} bytes`);
  }

  // Rest args carried the drawImage overloads; same trick here.
  texImage2D(target: number, level: number, internalformat: number, ...rest: number[]): void {
    console.log(`texImage2D: ${rest.length} extra args`);
  }
}

const c = new Ctx();
c.bufferData(0x8892, 1024, 0x88E4);
c.bufferData(0x8892, new Uint8Array(64), 0x88E4);
c.bufferData(0x8892, null, 0x88E4);
c.texImage2D(0x0DE1, 0, 0x1908, 0x1908, 0x1401, 0);
c.texImage2D(0x0DE1, 0, 0x1908, 16, 16, 0, 0x1908, 0x1401, 0);
console.log("polymorphic shapes compile");
