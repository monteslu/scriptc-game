/* URL resolution: the game directory is the web root.
 *
 * This is the one place node:fs is allowed on the game's behalf. A game says
 * `"images/player.png"` or `"/images/player.png"` and gets the same file
 * either way, exactly as a page served from its own directory would.
 *
 * The rule is copied from jsgamelauncher (image.js getFinalUrl), because
 * games are written against it:
 *
 *   - at startup, the root is `<gameDir>/public` if that exists, else `<gameDir>`
 *   - a URL starting with http://, https://, data:, blob: or // passes through
 *     untouched (there is no network here, so those simply fail to read)
 *   - anything else is joined onto the root, path-join style, so a leading
 *     "/" is absorbed and means "web root" rather than "filesystem root"
 *
 * Deliberately NOT copied: jsgamelauncher's inconsistencies, where
 * createLoadImage skips the public/ check and fetch/xhr treat data: URLs as
 * file paths. One rule, applied everywhere.
 */
import { readFileSync, existsSync } from "node:fs";

let webRoot = ".";

/** Host-only: sets the web root from the game directory. */
export function setGameDir(dir: string): void {
  const pub = joinPath(dir, "public");
  webRoot = existsSync(pub) ? pub : dir;
}

export function getWebRoot(): string { return webRoot; }

/** True for URLs that name something other than a file under the web root. */
export function isExternalUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith("http://") || u.startsWith("https://") ||
         u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("//");
}

/** Joins two path segments with a single separator. */
function joinPath(a: string, b: string): string {
  if (a === "") return b;
  if (b === "") return a;
  const left = a.endsWith("/") ? a.substring(0, a.length - 1) : a;
  const right = b.startsWith("/") ? b.substring(1) : b;
  return `${left}/${right}`;
}

/** Resolves a game-facing URL to a filesystem path. */
export function resolveUrl(url: string): string {
  if (isExternalUrl(url)) return url;
  return joinPath(webRoot, url);
}

/* Asset failures WARN.
 *
 * A rejected promise with no `.catch` attached is silent, and game code
 * rarely attaches one to an asset load. That is how a broken music path went
 * unnoticed through a whole release: the file was fine, the decode was fine,
 * and the promise chain simply never ran. A missing or unreadable asset is
 * almost always a bug in the game, so it says so once, on stderr, naming the
 * path it actually tried.
 *
 * Deduplicated by path: a loader retrying every frame should not scroll the
 * terminal. */
const warned = new Set<string>();

export function warnAsset(kind: string, url: string, detail: string): void {
  const key = `${kind}:${url}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.log(`[scriptc-game] ${kind} failed: ${url}${detail === "" ? "" : ` (${detail})`}`);
}

/** Reads a file, or null when it is missing or unreadable. */
export function readBinary(path: string): Buffer | null {
  if (isExternalUrl(path)) return null;   // no network stack in this build
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

export function fileExists(path: string): boolean {
  return !isExternalUrl(path) && existsSync(path);
}
