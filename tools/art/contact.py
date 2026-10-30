import json, os, sys
from PIL import Image, ImageDraw, ImageFont
P = sys.argv[1]; M = json.load(open(os.path.join(P, "manifest.json")))
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
cats = ["tiles", "fences", "crops", "animals", "buildings", "props", "icons"]
W = 1800; sections = []
for cat in cats:
    cells = []
    for a in M["assets"]:
        if a["category"] != cat: continue
        r = a["res"]["1x"]
        im = Image.open(os.path.join(P, r["file"])).convert("RGBA")
        if a["type"] == "spritesheet":
            # first frame of each walk row (or whole first row for sails)
            fw, fh = r["frameWidth"], r["frameHeight"]
            rows = [an for an in a["animations"] if an["anim"] in ("walk", "spin")]
            strip = Image.new("RGBA", (fw * min(4, len(rows)) if rows[0]["anim"] == "walk" else fw, fh))
            if rows[0]["anim"] == "walk":
                for i, an in enumerate(rows[:4]):
                    f = an["start"]; c = r["columns"]
                    strip.alpha_composite(im.crop(((f % c) * fw, (f // c) * fh, (f % c + 1) * fw, (f // c + 1) * fh)), (i * fw, 0))
            else:
                strip.alpha_composite(im.crop((0, 0, fw, fh)))
            im = strip
        if "shadow" in r and a["type"] == "image":
            sh = Image.open(os.path.join(P, r["shadow"])).convert("RGBA")
            base = Image.new("RGBA", im.size, (0, 0, 0, 0)); base.alpha_composite(sh); base.alpha_composite(im); im = base
        s = min(1.0, 300 / im.width, 260 / im.height)
        if s < 1: im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        cells.append((a["name"], im))
    x = y = rowh = 0; placed = []
    for nm, im in cells:
        cw = max(im.width, 110) + 16
        if x + cw > W: x = 0; y += rowh + 26; rowh = 0
        placed.append((nm, im, x, y)); x += cw; rowh = max(rowh, im.height)
    h = y + rowh + 26 + 40
    sec = Image.new("RGBA", (W, h), (232, 238, 222, 255)); d = ImageDraw.Draw(sec)
    d.text((10, 8), cat.upper(), fill=(44, 42, 31), font=bold)
    for nm, im, x, y in placed:
        sec.alpha_composite(im, (x + 10, y + 40)); d.text((x + 10, y + 40 + im.height + 4), nm, fill=(80, 78, 64), font=font)
    sections.append(sec)
out = Image.new("RGBA", (W, sum(s.height for s in sections)), (232, 238, 222, 255)); y = 0
for s in sections: out.alpha_composite(s, (0, y)); y += s.height
out.convert("RGB").save(sys.argv[2], quality=90); print(out.size)
