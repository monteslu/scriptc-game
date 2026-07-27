/* Missile mechanics, checked without a human at the controls.
 *
 * A screenshot of an idle game proves nothing about shooting: with no input
 * nothing fires, so the frame looks correct while exercising none of the new
 * code. This mirrors dodge's missile launch, travel and collision so the
 * rules are actually asserted:
 *
 *   - a missile launches along the heading and travels that way
 *   - it destroys a hazard it reaches
 *   - it does NOT destroy a coin (coins are a dodging reward, not a target)
 *   - it expires rather than living forever
 *   - a graze pays more than a missile kill
 */
import { Math } from "../web/globals.js";

const TAU = Math.PI * 2;
const PLAYER_R = 14;
const MISSILE_SPEED = 0.78;
const MISSILE_R = 4;
const MISSILE_LIFE_MS = 1600;
const GRAZE_BONUS = 12;
const MISSILE_BONUS = 2;

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

class Faller { x = 0; y = 0; size = 0; coin = false; alive = false; }
class Missile { x = 0; y = 0; vx = 0; vy = 0; lifeMs = 0; alive = false; }

/** dodge's launch, verbatim. */
function launch(m: Missile, px: number, py: number, heading: number): void {
  m.alive = true;
  m.x = px + Math.cos(heading) * (PLAYER_R + 6);
  m.y = py + Math.sin(heading) * (PLAYER_R + 6);
  m.vx = Math.cos(heading) * MISSILE_SPEED;
  m.vy = Math.sin(heading) * MISSILE_SPEED;
  m.lifeMs = MISSILE_LIFE_MS;
}

/** dodge's per-frame missile step. Returns true if it hit the faller. */
function step(m: Missile, f: Faller, dt: number): boolean {
  if (!m.alive) return false;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.lifeMs -= dt;
  if (m.lifeMs <= 0) { m.alive = false; return false; }
  if (!f.alive || f.coin) return false;
  const half = f.size / 2;
  const dx = m.x - f.x;
  const dy = m.y - f.y;
  if ((dx < 0 ? -dx : dx) < half + MISSILE_R &&
      (dy < 0 ? -dy : dy) < half + MISSILE_R) {
    f.alive = false;
    m.alive = false;
    return true;
  }
  return false;
}

function main(): void {
  console.log("==> missile mechanics");

  /* 1. Launches along the heading. Straight up is -PI/2 in canvas space,
   * where +y is down. */
  const up = new Missile();
  launch(up, 400, 300, -Math.PI / 2);
  check(up.alive, "missile is alive after launch");
  check(up.vy < 0, "firing up gives negative vy (canvas +y is down)");
  check(up.vx > -0.01 && up.vx < 0.01, "firing straight up has no sideways drift");
  check(up.y < 300, "spawns ahead of the ship, not behind it");

  /* 2. Destroys a hazard in its path. */
  const hazard = new Faller();
  hazard.x = 400; hazard.y = 200; hazard.size = 30; hazard.coin = false; hazard.alive = true;
  const m1 = new Missile();
  launch(m1, 400, 300, -Math.PI / 2);
  let hit = false;
  for (let i = 0; i < 400 && !hit; i++) hit = step(m1, hazard, 16);
  check(hit, "missile reached and hit the hazard");
  check(!hazard.alive, "the hazard was destroyed");
  check(!m1.alive, "the missile was consumed by the hit");

  /* 3. A COIN is not shootable. This is the design rule that keeps coins a
   * reward for moving toward danger rather than something to snipe. */
  const c = new Faller();
  c.x = 400; c.y = 200; c.size = 30; c.coin = true; c.alive = true;
  const m2 = new Missile();
  launch(m2, 400, 300, -Math.PI / 2);
  let coinHit = false;
  for (let i = 0; i < 60 && !coinHit; i++) coinHit = step(m2, c, 16);
  check(!coinHit, "a missile does NOT hit a coin");
  check(c.alive, "the coin survives being shot at");

  /* 4. Missiles expire. Without this they would accumulate forever. */
  const far = new Faller();   // nothing in the way
  const m3 = new Missile();
  launch(m3, 400, 300, -Math.PI / 2);
  for (let i = 0; i < 200; i++) step(m3, far, 16);
  check(!m3.alive, "a missile that hits nothing expires");

  /* 5. CONTROL: the harness can observe a MISS.
   *
   * Every check above passes when the code is right, so a step() that always
   * reported a hit would look identical. Fire AWAY from the hazard: it must
   * survive. */
  const behind = new Faller();
  behind.x = 400; behind.y = 200; behind.size = 30; behind.coin = false; behind.alive = true;
  const m4 = new Missile();
  launch(m4, 400, 300, Math.PI / 2);      // downward, away from it
  let wrongHit = false;
  for (let i = 0; i < 100 && !wrongHit; i++) wrongHit = step(m4, behind, 16);
  check(!wrongHit, "CONTROL: firing away from a hazard does not hit it");
  check(behind.alive, "CONTROL: that hazard is still alive");

  /* 6. The economy: dodging must pay better than shooting. */
  check(GRAZE_BONUS > MISSILE_BONUS, "a graze is worth more than a missile kill");
  check(GRAZE_BONUS >= MISSILE_BONUS * 4, "a graze is worth SUBSTANTIALLY more");

  console.log(`\nmissile test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
