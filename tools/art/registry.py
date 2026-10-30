"""Collects assets for export."""
REG = []


def image(category, name, canvas, footprint=(1, 1), anchor=None, notes=None, shadow=True):
    """anchor (2x px) defaults to the canvas world origin, i.e. the footprint's top (north) vertex."""
    REG.append(dict(kind="image", category=category, name=name, canvas=canvas, footprint=list(footprint),
                    anchor=list(anchor or (canvas.ox, canvas.oy)), notes=notes, shadow=shadow))


def sheet(category, name, frames_by_row, frame_w, frame_h, anchor, rows_meta, fps=8, notes=None):
    """frames_by_row: list of lists of Canvas (each frame_w x frame_h)."""
    REG.append(dict(kind="sheet", category=category, name=name, rows=frames_by_row, fw=frame_w, fh=frame_h,
                    anchor=list(anchor), rows_meta=rows_meta, fps=fps, notes=notes))
