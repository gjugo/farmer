"""Put a tool in the farmer's hand: bind a prop GLB to a bone of the rigged farmer, so it follows the animation.

Usage: python attach_tool.py FARMER.glb OUT.glb TOOL.glb [--bone=R_Wrist] [--up=x|y|z] [--length=0.3]
                             [--grip=0.25] [--thick=F] [--spin=DEG] [--at=X,Y,Z] [--rot=RX,RY,RZ] [--flip]
                             [TOOL2.glb ...]

Each tool is fitted before it is bound. Its long side (the longest, or the one --up names: the handle of a hoe, the
height of a bucket) is scaled to LENGTH model units (the farmer is about 1 unit tall) and turned onto +Y (--flip
turns it onto -Y: the head at the bottom); THICK widens it across that side (a thin handle vanishes at game size).
It is turned SPIN degrees about that side and moved so the point GRIP of the way up it (0 = the bottom, 1 = the top,
before any flip) sits on the bone. ROT then turns it (degrees, about X, then Y, then Z) and AT moves it, in the
bone's frame. The farmer's bones have no rest rotation, so the bone's frame is the model's: +Y up, +Z the way he
faces, -X his right. Options after a TOOL apply to that tool, so one call can put a tool in each hand.
--bone=L_Wrist+R_Wrist shares the tool between both hands: it sits between them and follows their average.

Ludo's renderer draws only the skinned mesh, so a node parented to the bone is dropped. Instead each tool goes in as
extra primitives of the farmer's skinned mesh, every vertex weighted fully to the bone. FARMER and TOOL may be gzipped,
like the files in source/; OUT is gzipped when it ends in .gz.
"""
import gzip
import io
import math
import sys

import numpy as np
import trimesh
from pygltflib import (GLTF2, Accessor, Attributes, BufferView, Image, Material, PbrMetallicRoughness, Primitive,
                       Texture, TextureInfo)

FLOAT, UBYTE, UINT = 5126, 5121, 5125


def read(path):
    data = open(path, 'rb').read()
    return gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data


def rotation(rx, ry, rz):
    """3x3 matrix turning about X, then Y, then Z (degrees)."""
    cx, sx, cy, sy, cz, sz = (f(math.radians(a)) for a in (rx, ry, rz) for f in (math.cos, math.sin))
    x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return z @ y @ x


def bone_rest(g, bone):
    """The bone's rest position in the model (its parents' translations; the rig has no rest rotations)."""
    parent = {c: i for i, n in enumerate(g.nodes) for c in n.children or []}
    pos, i = np.zeros(3), bone
    while i is not None:
        n = g.nodes[i]
        if n.rotation and not np.allclose(n.rotation, [0, 0, 0, 1]):
            sys.exit(f'{n.name} has a rest rotation; attach_tool.py expects none')
        pos += np.array(n.translation or [0, 0, 0])
        i = parent.get(i)
    return pos


class Writer:
    """Appends binary data and accessors to a glTF's single buffer."""

    def __init__(self, g):
        self.g, self.blob = g, bytearray(g.binary_blob())

    def view(self, data, target=None):
        self.blob += b'\0' * (-len(self.blob) % 4)
        self.g.bufferViews.append(BufferView(buffer=0, byteOffset=len(self.blob), byteLength=len(data), target=target))
        self.blob += data
        return len(self.g.bufferViews) - 1

    def accessor(self, array, kind, ctype, target=34962, bounds=False):
        view = self.view(np.ascontiguousarray(array).tobytes(), target)
        acc = Accessor(bufferView=view, componentType=ctype, count=len(array), type=kind)
        if bounds:
            acc.min, acc.max = array.min(0).tolist(), array.max(0).tolist()
        self.g.accessors.append(acc)
        return len(self.g.accessors) - 1

    def close(self):
        self.g.buffers[0].byteLength = len(self.blob)
        self.g.set_binary_blob(bytes(self.blob))


def material(g, w, mat, name):
    """A glTF material for a trimesh material: its base colour texture (if any) and colour factor."""
    pbr = PbrMetallicRoughness(metallicFactor=0.0, roughnessFactor=1.0)
    image = getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)
    if image is not None:
        png = io.BytesIO()
        image.save(png, format='PNG')
        g.images.append(Image(bufferView=w.view(png.getvalue()), mimeType='image/png'))
        g.textures.append(Texture(source=len(g.images) - 1, sampler=0 if g.samplers else None))
        pbr.baseColorTexture = TextureInfo(index=len(g.textures) - 1)
    factor = getattr(mat, 'baseColorFactor', None)
    if factor is not None:
        pbr.baseColorFactor = (np.array(factor, dtype=float) / (255 if np.max(factor) > 1 else 1)).tolist()
    g.materials.append(Material(name=name, pbrMetallicRoughness=pbr))
    return len(g.materials) - 1


def attach(g, w, path, opts):
    bone_name = opts.get('bone', 'R_Wrist')
    bones = [next(i for i, n in enumerate(g.nodes) if n.name == name) for name in bone_name.split('+')]
    skin = next(n.skin for n in g.nodes if n.skin is not None)
    joint_ids = [g.skins[skin].joints.index(b) for b in bones]
    mesh = next(n.mesh for n in g.nodes if n.skin is not None)

    scene = trimesh.load(io.BytesIO(read(path)), file_type='glb', force='scene')
    parts = scene.dump()
    lo, hi = scene.bounds
    size = hi - lo
    long = 'xyz'.index(opts['up']) if 'up' in opts else int(np.argmax(size))
    grip = (lo + hi) / 2
    grip[long] = lo[long] + float(opts.get('grip', 0.25)) * size[long]
    upright = {0: rotation(0, 0, 90), 1: np.eye(3), 2: rotation(-90, 0, 0)}[long]  # longest side onto +Y
    if 'flip' in opts:
        upright = rotation(180, 0, 0) @ upright
    scale = float(opts.get('length', 0.3)) / size[long]
    stretch = np.full(3, float(opts.get('thick', 1)))
    stretch[long] = 1
    turn = rotation(*[float(v) for v in opts.get('rot', '0,0,0').split(',')]) @ rotation(0, float(opts.get('spin', 0)), 0) @ upright
    at = np.mean([bone_rest(g, b) for b in bones], axis=0) + np.array([float(v) for v in opts.get('at', '0,0,0').split(',')])

    for k, part in enumerate(parts):
        pos = ((part.vertices - grip) * scale * stretch) @ turn.T + at
        normals = np.asarray(part.vertex_normals) / stretch
        normals = (normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)) @ turn.T
        attrs = Attributes(POSITION=w.accessor(pos.astype(np.float32), 'VEC3', FLOAT, bounds=True),
                           NORMAL=w.accessor(normals.astype(np.float32), 'VEC3', FLOAT))
        uv = getattr(part.visual, 'uv', None)
        if uv is not None:
            uv = np.array(uv, dtype=np.float32)
            uv[:, 1] = 1 - uv[:, 1]  # trimesh flips V on load
            attrs.TEXCOORD_0 = w.accessor(uv, 'VEC2', FLOAT)
        n = len(pos)
        joints = np.zeros((n, 4), np.uint8)
        weights = np.zeros((n, 4), np.float32)
        for j, joint in enumerate(joint_ids):
            joints[:, j] = joint
            weights[:, j] = 1 / len(joint_ids)
        attrs.JOINTS_0 = w.accessor(joints, 'VEC4', UBYTE)
        attrs.WEIGHTS_0 = w.accessor(weights, 'VEC4', FLOAT)
        indices = w.accessor(part.faces.astype(np.uint32).reshape(-1), 'SCALAR', UINT, target=34963)
        mat = material(g, w, part.visual.material, f'tool_{bone_name}_{k}')
        g.meshes[mesh].primitives.append(Primitive(attributes=attrs, indices=indices, material=mat))
    print(f'{path} on {bone_name}: {len(parts)} part(s), size {size.round(3).tolist()}, scale {scale:.4f}')


def main():
    args = sys.argv[1:]
    farmer_path, out_path = args[0], args[1]
    tools, opts = [], None
    for a in args[2:]:
        if a.startswith('--'):
            key, _, value = a[2:].partition('=')
            opts[key] = value
        else:
            opts = {}
            tools.append((a, opts))

    g = GLTF2.load_from_bytes(read(farmer_path))
    w = Writer(g)
    for path, o in tools:
        attach(g, w, path, o)
    w.close()
    data = b''.join(g.save_to_bytes())
    open(out_path, 'wb').write(gzip.compress(data, 9) if out_path.endswith('.gz') else data)


if __name__ == '__main__':
    main()
