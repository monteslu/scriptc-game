class Ctx {
  private w = 0;
  private h = 0;
  constructor(w: number, h: number) { this.w = w; this.h = h; }
  get drawingBufferWidth(): number { return this.w; }
  get drawingBufferHeight(): number { return this.h; }
  set width(v: number) { this.w = v; }
}
function main(): void {
  const c = new Ctx(640, 360);
  console.log(`w=${c.drawingBufferWidth} h=${c.drawingBufferHeight}`);
  c.width = 1280;
  console.log(`after set w=${c.drawingBufferWidth}`);
}
main();
