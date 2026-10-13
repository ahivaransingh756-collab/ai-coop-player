"""Dependency-free behavior-pack builder. Never includes tests, .git or npm packages."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
version = '.'.join(map(str, manifest['header']['version']))
output = root / 'dist' / f'SpeedrunCoop-{version}.mcpack'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.write(root / 'manifest.json', 'manifest.json')
    for path in sorted((root / 'scripts').rglob('*.js')):
        archive.write(path, path.relative_to(root))
print(output)
