#!/usr/bin/env python3
"""Pull one member out of an `ar` archive, by filename suffix.

Exists because GNU ar cannot extract the Windows canvas archive. Its
members are stored under full build paths ("D:/a/.../skia_c.o"), and ar
reads the slashes as directories, so `ar x` reports "No such file or
directory" for every member and extracts nothing. llvm-ar handles it, but
it is not installed everywhere, and needing a specific toolchain to unpack
a vendored archive is its own problem.

Both long-name conventions are handled: GNU terminates entries in the "//"
table with "/\\n", while the Microsoft variant that the Windows build
produces terminates with NUL. Reading only one of them silently yields a
single enormous "name" containing the whole table, which is exactly the
failure this replaced.

    ar-extract.py <archive> <output-path> <suffix> [suffix...]
"""
import os
import sys


def members(data):
    """Yields (name, body) for each member, resolving long names."""
    if data[:8] != b"!<arch>\n":
        raise SystemExit("not an ar archive")
    pos = 8
    longnames = b""
    while pos + 60 <= len(data):
        header = data[pos:pos + 60]
        raw = header[0:16].decode("latin1").strip()
        try:
            size = int(header[48:58].decode("latin1").strip() or "0")
        except ValueError:
            break
        body = data[pos + 60:pos + 60 + size]

        name = raw
        if raw == "//":
            longnames = body
        elif raw.startswith("/") and raw[1:].isdigit():
            off = int(raw[1:])
            ends = [e for e in (longnames.find(b"\n", off),
                                longnames.find(b"\x00", off)) if e != -1]
            end = min(ends) if ends else len(longnames)
            name = longnames[off:end].decode("latin1")

        yield name.rstrip("/"), body
        pos += 60 + size + (size % 2)   # members are 2-byte aligned


def main():
    if len(sys.argv) < 4:
        raise SystemExit("usage: ar-extract.py <archive> <out> <suffix>...")
    archive, out = sys.argv[1], sys.argv[2]
    suffixes = tuple(sys.argv[3:])

    with open(archive, "rb") as fh:
        data = fh.read()

    for name, body in members(data):
        base = name.replace("\\", "/").split("/")[-1]
        if base.endswith(suffixes):
            os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
            with open(out, "wb") as fh:
                fh.write(body)
            print(f"extracted {base} ({len(body)} bytes)")
            return 0

    print(f"no member matching {suffixes} in {archive}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
