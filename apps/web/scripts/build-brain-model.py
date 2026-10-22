"""Convert Nilearn fsaverage5 pial/curvature GIFTI files to the local brain GLB.

Usage: python3 apps/web/scripts/build-brain-model.py SOURCE_DIRECTORY
Source filenames: pial_left.gii.gz, pial_right.gii.gz, curv_left.gii.gz,
curv_right.gii.gz. Requires numpy. See public/assets/brain-SOURCES.md.
"""
import base64
import gzip
import json
from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

import numpy as np

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / 'public/assets/anatomical-brain.glb'


def read_gifti(name):
    root = ET.fromstring(gzip.decompress((source / name).read_bytes()))
    result = []
    for array in root.findall('DataArray'):
        dtype = '<f4' if array.attrib['DataType'] == 'NIFTI_TYPE_FLOAT32' else '<i4'
        data = zlib.decompress(base64.b64decode(array.findtext('Data')))
        shape = tuple(int(array.attrib[f'Dim{i}']) for i in range(int(array.attrib['Dimensionality'])))
        result.append(np.frombuffer(data, dtype=dtype).reshape(shape).copy())
    return result


hemispheres = []
for side in ['left', 'right']:
    positions, faces = read_gifti(f'pial_{side}.gii.gz')
    curvature, = read_gifti(f'curv_{side}.gii.gz')
    # RAS to a right-handed, Y-up scene with the anterior surface facing +Z.
    positions = positions[:, [0, 2, 1]] * [-1, 1, 1]
    hemispheres.append((side, positions, faces, curvature))
all_positions = np.concatenate([entry[1] for entry in hemispheres])
center = (all_positions.min(axis=0) + all_positions.max(axis=0)) / 2
scale = 2.3 / np.ptp(all_positions, axis=0).max()

binary = bytearray()
views, accessors, meshes = [], [], []


def accessor(array, component_type, kind, target_type):
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    binary.extend(array.tobytes())
    view = len(views)
    views.append(dict(buffer=0, byteOffset=offset, byteLength=array.nbytes, target=target_type))
    item = dict(bufferView=view, componentType=component_type, count=len(array), type=kind)
    if kind == 'VEC3':
        item.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
    accessors.append(item)
    return len(accessors) - 1


for side, positions, faces, curvature in hemispheres:
    positions = ((positions - center) * scale).astype('<f4')
    normals = np.zeros_like(positions)
    triangles = positions[faces]
    face_normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-10)
    # Curvature darkens the actual sulci and warms the raised gyri.
    shade = (1 / (1 + np.exp(curvature * 6)))[:, None]
    shadow = np.array([0.48, 0.20, 0.23])
    highlight = np.array([0.91, 0.65, 0.59])
    srgb = shadow + shade * (highlight - shadow)
    colors = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).astype('<f4')
    assert np.isfinite(positions).all() and np.isfinite(normals).all()
    assert faces.min() >= 0 and faces.max() < len(positions)
    attributes = dict(POSITION=accessor(positions, 5126, 'VEC3', 34962), NORMAL=accessor(normals, 5126, 'VEC3', 34962), COLOR_0=accessor(colors, 5126, 'VEC3', 34962))
    indices = accessor(faces.astype('<u2').reshape(-1), 5123, 'SCALAR', 34963)
    meshes.append(dict(name=f'{side} cerebral hemisphere', primitives=[dict(attributes=attributes, indices=indices, material=0)]))

while len(binary) % 4:
    binary.append(0)
gltf = dict(asset=dict(version='2.0', generator='ClearHead fsaverage5 converter', copyright='Nilearn developers; see brain-LICENSE.txt and brain-SOURCES.md'), scene=0, scenes=[dict(nodes=[0, 1])], nodes=[dict(mesh=0), dict(mesh=1)], meshes=meshes, materials=[dict(name='Natural rose cortex', pbrMetallicRoughness=dict(baseColorFactor=[1, 1, 1, 1], metallicFactor=0, roughnessFactor=0.68))], buffers=[dict(byteLength=len(binary))], bufferViews=views, accessors=accessors)
metadata = json.dumps(gltf, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
output = struct.pack('<III', 0x46546C67, 2, 28 + len(metadata) + len(binary))
output += struct.pack('<II', len(metadata), 0x4E4F534A) + metadata
output += struct.pack('<II', len(binary), 0x004E4942) + binary
target.write_bytes(output)
print(f'Created {target.name}: {len(output):,} bytes, 20,484 vertices, 40,960 triangles')
