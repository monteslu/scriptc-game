# dodge assets

`music.mp3` is **not committed** (see the root `.gitignore`): a background
track is the user's own file, it would bloat every clone, and shipping one
raises a licensing question the example does not need to answer.

Drop any `.mp3`, `.ogg`, `.wav` or `.flac` in here as `music.mp3` and it plays
on a loop under the sound effects. Without it the game runs silent-but-playable
and says so once at startup.

The decoders are the same header-only libraries webaudio-node uses
(dr_mp3/dr_wav/dr_flac, stb_vorbis); `test/decodetest.ts` covers all four.
