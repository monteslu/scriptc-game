/* Generated-entry stand-in.
 *
 * Order matters and mirrors a browser page: the window/DOM exists BEFORE any
 * script runs, so the host opens the window first, then the game module is
 * evaluated (registering its rAF), then the loop starts. */
import { boot, run, HostOptions, optionsFromEnv, defaultGameDir } from "../../host/runtime.js";

const opts = optionsFromEnv(new HostOptions());
opts.width = 480;
opts.height = 270;
opts.gameDir = defaultGameDir();

const brc = boot(opts);
if (brc !== 0) process.exit(brc);

// The game's top level runs here, with a live document -- as in a page.
import "./main.js";

process.exit(run(opts));
