"""Export everything: PNGs at 2x (256px tiles) and 1x (128px tiles), shadow layers,
sprite sheets and manifest.json."""
import os, sys, json, shutil
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(__file__))
import tiles, crops, animals, buildings, icons, props, people, seasonal
from registry import REG

OUT = sys.argv[1] if len(sys.argv) > 1 else "out/isometric-farm-pack"
NO_TRIM = {"tiles"}
SCALES = {"2x": 1.0, "1x": 0.5}


def collect():
    REG.clear()
    for m in (tiles, crops, animals, buildings, icons, props, people, seasonal):
        m.build()
    return REG


def even_bbox(boxes, w, h):
    boxes = [b for b in boxes if b]
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    x0 = max(0, (x0 - 2) // 2 * 2); y0 = max(0, (y0 - 2) // 2 * 2)
    x1 = min(w, (x1 + 3) // 2 * 2); y1 = min(h, (y1 + 3) // 2 * 2)
    return x0, y0, x1, y1


def export_image(e):
    c = e["canvas"]
    main2 = c.render(1.0)
    sh2 = c.render_shadow(1.0) if e["shadow"] else None
    if e["category"] in NO_TRIM:
        box = (0, 0, main2.width - main2.width % 2, main2.height - main2.height % 2)
    else:
        box = even_bbox([main2.getbbox(), sh2.getbbox() if sh2 else None], main2.width, main2.height)
    rec = dict(name=e["name"], category=e["category"], type="image", footprint=e["footprint"], notes=e["notes"], res={})
    for res, s in SCALES.items():
        if s == 1.0:
            m, sh = main2, sh2
        else:
            m = c.render(s)
            sh = c.render_shadow(s) if e["shadow"] else None
        b = tuple(int(v * s) for v in box)
        d = os.path.join(OUT, res, e["category"])
        os.makedirs(d, exist_ok=True)
        m.crop(b).save(os.path.join(d, e["name"] + ".png"), optimize=True)
        r = dict(file=f"{res}/{e['category']}/{e['name']}.png", w=b[2] - b[0], h=b[3] - b[1])
        if sh is not None:
            sh.crop(b).save(os.path.join(d, e["name"] + "_shadow.png"), optimize=True)
            r["shadow"] = f"{res}/{e['category']}/{e['name']}_shadow.png"
        ax, ay = (e["anchor"][0] - box[0]) * s, (e["anchor"][1] - box[1]) * s
        r["anchor"] = [round(ax, 2), round(ay, 2)]
        r["origin"] = [round(ax / r["w"], 5), round(ay / r["h"], 5)]
        rec["res"][res] = r
    return rec


def export_sheet(e):
    rows = e["rows"]
    rec = dict(name=e["name"], category=e["category"], type="spritesheet", notes=e["notes"], res={}, animations=[])
    for res, s in SCALES.items():
        rendered = []
        for ri, row in enumerate(rows):
            mir = e["rows_meta"][ri].get("mirror")
            rr = []
            for c in row:
                m = c.render(s)
                sh = c.render_shadow(s)
                if mir:
                    m = ImageOps.mirror(m)
                    sh = ImageOps.mirror(sh) if sh else None
                rr.append((m, sh))
            rendered.append(rr)
        fw, fh = rendered[0][0][0].size
        box = even_bbox([im.getbbox() for rr in rendered for (m, sh) in rr for im in (m, sh) if im is not None], fw, fh)
        cw, ch = box[2] - box[0], box[3] - box[1]
        cols = max(len(r) for r in rendered)
        sheet = Image.new("RGBA", (cols * cw, len(rendered) * ch), (0, 0, 0, 0))
        shs = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
        for ri, rr in enumerate(rendered):
            for fi, (m, sh) in enumerate(rr):
                sheet.alpha_composite(m.crop(box), (fi * cw, ri * ch))
                if sh is not None:
                    shs.alpha_composite(sh.crop(box), (fi * cw, ri * ch))
        d = os.path.join(OUT, res, e["category"])
        os.makedirs(d, exist_ok=True)
        sheet.save(os.path.join(d, e["name"] + ".png"), optimize=True)
        r = dict(file=f"{res}/{e['category']}/{e['name']}.png", frameWidth=cw, frameHeight=ch, columns=cols, rows=len(rendered))
        if shs.getbbox():
            shs.save(os.path.join(d, e["name"] + "_shadow.png"), optimize=True)
            r["shadow"] = f"{res}/{e['category']}/{e['name']}_shadow.png"
        ax, ay = e["anchor"][0] * s - box[0], e["anchor"][1] * s - box[1]
        r["anchor"] = [round(ax, 2), round(ay, 2)]
        r["origin"] = [round(ax / cw, 5), round(ay / ch, 5)]
        rec["res"][res] = r
    cols = rec["res"]["2x"]["columns"]
    for ri, m in enumerate(e["rows_meta"]):
        key = f"{e['name']}_{m['anim']}" + (f"_{m['dir']}" if m["dir"] != "-" else "")
        rec["animations"].append(dict(key=key, anim=m["anim"], dir=m["dir"], start=ri * cols, end=ri * cols + m["frames"] - 1,
                                      frames=m["frames"], fps=m["fps"], repeat=-1))
    return rec


def work(i):
    e = REG[i]
    return export_image(e) if e["kind"] == "image" else export_sheet(e)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    collect()
    with ProcessPoolExecutor() as ex:
        recs = list(ex.map(work, range(len(REG))))
    manifest = dict(
        name="Isometric Farm Pack", version="1.0",
        projection="2:1 dimetric (isometric) – tile diamond is twice as wide as it is tall",
        tile={"2x": {"width": 256, "height": 128}, "1x": {"width": 128, "height": 64}},
        conventions={
            "world": "tile x runs screen down-right, tile y runs screen down-left",
            "anchor": "pixel inside the image that sits on the footprint's TOP (north) corner of tile (tx,ty) – "
                      "for animals: the ground point under the animal. Use origin=[ax/w, ay/h] with Phaser setOrigin().",
            "screen_position": "screenX = originX + (tx - ty) * tileWidth/2 ; screenY = originY + (tx + ty) * tileHeight/2",
            "depth": "sort objects by (tx + ty + footprintW + footprintH) or by the screen Y of their footprint's bottom corner; draw all shadow layers below sprites",
            "footprint": "[tiles along x, tiles along y]",
            "directions": "se = toward +x, sw = toward +y, ne = toward -y, nw = toward -x",
        },
        assets=recs)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print("exported", len(recs), "assets")


if __name__ == "__main__":
    main()
