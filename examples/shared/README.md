# Shared example assets

The one real copy of every asset more than one example uses. Each
`examples/<game>/public/<asset>` is a **symlink** into this directory.

Without this the music alone was committed twice (3.8MB each) and the font
three times. Git deduplicates identical blobs internally, so the clone was
never actually twice the size, but the working tree was, and it was unclear
which copy to edit.

Games are unaffected. A game still writes a bare filename resolved against
its own web root:

```ts
img.src = "player.png";      // examples/dodge/public/player.png -> here
fetch("music.mp3");
```

The OS follows the link, so `existsSync`/`readFileSync` in `host/resources.ts`
behave exactly as they would for a real file. Nothing in `web/` knows or
cares. In a browser these would be ordinary files served from the game
directory, which is what a bundler or a copy step would produce.

## Windows

Git needs symlink support enabled, or a clone gets plain text files
containing the link target instead of the asset:

```sh
git config --global core.symlinks true
```

That needs Developer Mode, or an elevated shell. If assets fail to load on
Windows with "unsupported or corrupt", this is why: check whether
`examples/dodge/public/player.png` is 20 bytes of text rather than a PNG.
