/* An optional asset loader: load everything, then start.
 *
 * OPTIONAL, like the rest of engine/. `examples/dodge` counts its own onload
 * callbacks and never imports this. It exists because every game writes some
 * version of it, and the hand-rolled version is usually the one with the bug.
 *
 * Built on `new Image()`, `fetch` and `decodeAudioData` from web/globals.js,
 * so it runs unchanged in a browser. The shape follows the loader in
 * simple-jsgame-starter, so loading-screen code written against that ports
 * over directly.
 *
 * ## Failures resolve, they do not reject
 *
 * `load()` settles once every asset has either arrived or failed, and a
 * missing file does not reject the whole batch. A game that loses one sound
 * should still boot, and one bad path should not leave the loading screen
 * spinning forever with no clue why.
 *
 * That is not silent: web/ already warns to the terminal, naming the path it
 * tried, and `failed()` lists what did not arrive so a game can decide for
 * itself whether to continue.
 */
import { Image, fetch, AudioBuffer, AudioContext } from "../web/globals.js";

class PendingImage {
  name: string = "";
  url: string = "";
}

class PendingSound {
  name: string = "";
  url: string = "";
}

export class ResourceLoader {
  private pendingImages: PendingImage[] = [];
  private pendingSounds: PendingSound[] = [];
  private images: Map<string, Image> = new Map<string, Image>();
  private sounds: Map<string, AudioBuffer> = new Map<string, AudioBuffer>();
  private failedNames: string[] = [];
  private total: number = 0;
  private done: number = 0;
  private audio: AudioContext | null = null;

  /** Audio context used to decode sounds. Without one, sounds are skipped. */
  constructor(audio: AudioContext | null) {
    this.audio = audio;
  }

  addImage(name: string, url: string): void {
    const p = new PendingImage();
    p.name = name;
    p.url = url;
    this.pendingImages.push(p);
    this.total += 1;
  }

  addSound(name: string, url: string): void {
    const p = new PendingSound();
    p.name = name;
    p.url = url;
    this.pendingSounds.push(p);
    this.total += 1;
  }

  /** A loaded image, or null when it is missing or still loading. */
  getImage(name: string): Image | null {
    const img = this.images.get(name);
    return img === undefined ? null : img;
  }

  /** A decoded sound, or null when it is missing or still loading. */
  getSound(name: string): AudioBuffer | null {
    const buf = this.sounds.get(name);
    return buf === undefined ? null : buf;
  }

  /** 0..1, for a loading bar. */
  getPercentComplete(): number {
    return this.total === 0 ? 1 : this.done / this.total;
  }

  /** Names that did not load. Empty when everything arrived. */
  failed(): string[] { return this.failedNames; }

  private finish(): void { this.done += 1; }

  /** Resolves once every asset has arrived or failed. */
  load(): Promise<ResourceLoader> {
    return new Promise<ResourceLoader>((resolve) => {
      if (this.total === 0) { resolve(this); return; }

      const settle = () => {
        if (this.done >= this.total) resolve(this);
      };

      for (let i = 0; i < this.pendingImages.length; i++) {
        const p = this.pendingImages[i];
        const img = new Image();
        img.onload = () => {
          this.images.set(p.name, img);
          this.finish();
          settle();
        };
        img.onerror = () => {
          this.failedNames.push(p.name);
          this.finish();
          settle();
        };
        img.src = p.url;
      }

      for (let i = 0; i < this.pendingSounds.length; i++) {
        const p = this.pendingSounds[i];
        const ctx = this.audio;
        if (ctx === null) {
          this.failedNames.push(p.name);
          this.finish();
          settle();
          continue;
        }
        fetch(p.url)
          .then((res) => res.arrayBuffer())
          .then((bytes) => ctx.decodeAudioData(bytes))
          .then((buf) => {
            this.sounds.set(p.name, buf);
            this.finish();
            settle();
          })
          .catch(() => {
            this.failedNames.push(p.name);
            this.finish();
            settle();
          });
      }
    });
  }
}

/** Creates a loader. `audio` may be null when a game has no sound. */
export function createResourceLoader(audio: AudioContext | null): ResourceLoader {
  return new ResourceLoader(audio);
}
