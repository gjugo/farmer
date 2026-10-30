"""Rebuild the farm art pack from source and copy what the game ships into public/assets/farm/.

Run through `npm run art` (tools/art/art.sh sets up the venv first). The pack's own build.py is used
unchanged; this wrapper only makes it run the same way on every machine:

- build.py deletes its output folder before writing, so it always builds into a fresh temp folder
  outside the repo, never into the repo itself.
- build.py fills its registry in main() and hands indexes to a process pool. That only works where
  workers are forked (Linux). Here every worker gets an initializer that rebuilds the registry itself
  (it is deterministic: every random draw is seeded), so the default start method works on macOS too.
- The pack's text ("FOR SALE", "$") asks for "DejaVu Sans" bold, which most Macs don't have; cairo
  would silently pick another font. The font is bundled in fonts/ and every worker draws it with
  FreeType, unhinted, like the committed art (see use_bundled_font).

Afterwards it copies 1x/, 2x/ and manifest.json into public/assets/farm/. A PNG whose pixels are
unchanged is left alone, so a different zlib/Pillow build doesn't churn the committed files. Nothing
is deleted: files the build no longer makes are only listed.
"""
import functools, os, shutil, sys, tempfile
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEST = os.path.join(REPO, "public", "assets", "farm")
FONTS = os.path.join(HERE, "fonts")
# What the game ships from the pack (see src/scenes/art.ts): both resolutions and the manifest.
SHIPPED_DIRS = ("1x", "2x")
MANIFEST = "manifest.json"


def use_bundled_font():
    """Draw the pack's text with fonts/DejaVuSans-Bold.ttf through cairo's FreeType backend, unhinted.

    That is how the committed art was rendered. Left to itself cairo would look the family up among the
    system fonts and, on macOS, rasterise it with CoreText; either changes the edge pixels of the glyphs.
    """
    import ctypes, ctypes.util
    import cairocffi
    libs = {name: ctypes.util.find_library(name) for name in ("fontconfig", "cairo")}
    if not all(libs.values()):
        sys.exit("The fontconfig library was not found (cairo needs it): brew install cairo / sudo apt install libfontconfig1")
    fc, cairo = ctypes.CDLL(libs["fontconfig"]), ctypes.CDLL(libs["cairo"])
    fc.FcInit()
    fc.FcPatternCreate.restype = ctypes.c_void_p
    fc.FcPatternAddString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    fc.FcPatternAddInteger.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    fc.FcPatternAddBool.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    cairo.cairo_ft_font_face_create_for_pattern.restype = ctypes.c_void_p
    cairo.cairo_ft_font_face_create_for_pattern.argtypes = [ctypes.c_void_p]
    pattern = fc.FcPatternCreate()
    fc.FcPatternAddString(pattern, b"file", os.path.join(FONTS, "DejaVuSans-Bold.ttf").encode())
    fc.FcPatternAddInteger(pattern, b"index", 0)
    fc.FcPatternAddBool(pattern, b"hinting", 0)
    pointer = cairo.cairo_ft_font_face_create_for_pattern(pattern)
    face = cairocffi.FontFace._from_pointer(cairocffi.ffi.cast("cairo_font_face_t *", pointer), incref=False)

    select_font_face = cairocffi.Context.select_font_face

    def select_bundled(self, family="", slant=cairocffi.FONT_SLANT_NORMAL, weight=cairocffi.FONT_WEIGHT_NORMAL):
        # core.Canvas.text always asks for DejaVu Sans bold, upright.
        if family == "DejaVu Sans" and slant == cairocffi.FONT_SLANT_NORMAL and weight == cairocffi.FONT_WEIGHT_BOLD:
            self.set_font_face(face)
        else:
            select_font_face(self, family, slant, weight)

    cairocffi.Context.select_font_face = select_bundled


def init_worker(out):
    """Pool initializer: what a forked worker would have inherited from build.main()."""
    use_bundled_font()
    import build
    build.OUT = out
    build.collect()


def run_build(out):
    sys.argv = [os.path.join(HERE, "build.py"), out]
    import build
    build.OUT = out
    build.ProcessPoolExecutor = functools.partial(ProcessPoolExecutor, initializer=init_worker, initargs=(out,))
    build.main()


def same_pixels(a, b):
    import numpy as np
    from PIL import Image
    with Image.open(a) as x, Image.open(b) as y:
        if x.size != y.size:
            return False
        return np.array_equal(np.asarray(x.convert("RGBA")), np.asarray(y.convert("RGBA")))


def same_bytes(a, b):
    with open(a, "rb") as x, open(b, "rb") as y:
        return x.read() == y.read()


def shipped_files(root):
    files = [MANIFEST] if os.path.exists(os.path.join(root, MANIFEST)) else []
    for d in SHIPPED_DIRS:
        for base, _, names in os.walk(os.path.join(root, d)):
            files += [os.path.relpath(os.path.join(base, n), root) for n in names if n.endswith(".png")]
    return sorted(files)


def copy_into_repo(pack):
    written, kept = [], 0
    for rel in shipped_files(pack):
        src, dst = os.path.join(pack, rel), os.path.join(DEST, rel)
        if os.path.exists(dst) and (same_bytes(src, dst) or (rel.endswith(".png") and same_pixels(src, dst))):
            kept += 1
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        written.append(rel)
    stale = sorted(set(shipped_files(DEST)) - set(shipped_files(pack)))
    return written, kept, stale


def main():
    tmp = tempfile.mkdtemp(prefix="farm-art-")
    if os.path.commonpath([os.path.realpath(tmp), os.path.realpath(REPO)]) == os.path.realpath(REPO):
        sys.exit(f"Temp folder {tmp} is inside the repo; refusing to let build.py delete it.")
    try:
        pack = os.path.join(tmp, "isometric-farm-pack")
        run_build(pack)
        written, kept, stale = copy_into_repo(pack)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    rel_dest = os.path.relpath(DEST, REPO)
    print(f"{rel_dest}: {len(written)} file(s) written, {kept} unchanged.")
    for rel in written:
        print(f"  wrote {rel}")
    if stale:
        print("Not made by the build any more (left in place, delete them if the game no longer uses them):")
        for rel in stale:
            print(f"  {rel}")


if __name__ == "__main__":
    main()
