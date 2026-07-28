/* macOS framework requirements, carried INSIDE the archive.
 *
 * Skia's macOS build needs Apple frameworks: SkFontMgr_New_CoreText is a
 * real symbol in libskia.a, and the font stack pulls CoreGraphics and
 * CoreFoundation in behind it. Frameworks link with `-framework Foo`, not
 * `-lfoo`.
 *
 * scriptc's FFI manifest cannot express that. `system_libraries` is
 * validated against /^[A-Za-z0-9_+.-]+$/ and every entry is emitted as
 * `-l<name>`, so a "framework:CoreText" entry fails the manifest outright
 * with SC5001 and there is no flag to smuggle one through.
 *
 * The way out does not touch the compiler. Mach-O objects can carry their
 * own link requirements as LC_LINKER_OPTION load commands, which ld reads
 * and acts on with nothing on the command line. That is exactly what Rust's
 * #[link(kind = "framework")] emits, and how @napi-rs/canvas links this
 * same Skia without its callers passing framework flags.
 *
 * So this file is compiled into libsggfx.a on macOS only, and the linker
 * discovers the frameworks from the archive itself.
 *
 * GL needs nothing here: SKIA_GL_STANDARD is "gl" in the build-libcanvas
 * macOS output, and SDL2 brings its own OpenGL linkage.
 */
#if defined(__APPLE__)

__asm__(".linker_option \"-framework\", \"CoreText\"");
__asm__(".linker_option \"-framework\", \"CoreGraphics\"");
__asm__(".linker_option \"-framework\", \"CoreFoundation\"");
__asm__(".linker_option \"-framework\", \"CoreServices\"");

/* A defined symbol so the member is never dropped from the archive: a
 * member with no referenced symbols can be skipped entirely, and its
 * load commands would go with it. host/ffi.ts calls this once at init. */
int sg_macos_link_anchor(void) { return 0; }

#else

/* Every other platform links frameworks not at all. The TU still compiles
 * so the build script needs no per-platform source list. */
int sg_macos_link_anchor(void) { return 0; }

#endif
