declare function sgThreadStart(u: number): number;
declare function sgThreadCount(u: number): number;
declare function sgThreadStop(u: number): void;

class Ent { x = 0; y = 0; constructor(x: number, y: number) { this.x = x; this.y = y; } }

function main(): void {
  let rc = sgThreadStart(0); rc += 0;
  console.log(`thread start rc=${rc}`);
  let acc = 0;
  for (let frame = 0; frame < 200000; frame++) {
    const pool: Ent[] = [];
    for (let i = 0; i < 10; i++) { pool.push(new Ent(i, frame)); }
    for (let i = 0; i < pool.length; i++) { acc += pool[i].x; }
  }
  let c1 = sgThreadCount(0); c1 += 0;
  console.log(`churn done acc=${acc} thread=${c1 > 0 ? "advancing" : "STUCK"}`);
  sgThreadStop(0);
  console.log("thread stopped cleanly");
}
main();
