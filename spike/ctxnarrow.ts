/* If getContext returns a union, can EXISTING 2D code still use it?
 * The examples all write: const ctx = canvas.getContext("2d")!;
 * then call ctx.fillRect(...) directly. */
class Ctx2D { fillRect(x: number, y: number, w: number, h: number): void {} }
class CtxGL { clear(mask: number): void {} }

class Canvas {
  getContext(kind: string): Ctx2D | CtxGL | null {
    return kind === "2d" ? new Ctx2D() : null;
  }
}
const c = new Canvas();
const ctx = c.getContext("2d")!;
ctx.fillRect(0, 0, 10, 10);   // does a union member resolve?
console.log("narrowing works");
