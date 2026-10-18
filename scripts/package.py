"""Create deterministic source and Lambda archives, without credentials/caches."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib, json
root=Path(__file__).resolve().parents[1]
out=root/'artifacts';out.mkdir(exist_ok=True)
def archive(path, entries):
    with ZipFile(path,'w',ZIP_DEFLATED,compresslevel=9) as z:
        for name,p in sorted(entries):
            info=ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,p.read_bytes())
archive(out/'brekmate-lambda.zip',[(p.name,p) for p in (root/'dist').iterdir() if p.name in {'index.mjs','package.json'}])
files=[p for p in root.rglob('*') if p.is_file() and not any(part in {'node_modules','artifacts','.git','coverage'} for part in p.relative_to(root).parts) and not p.name.startswith('.env')]
archive(out/'BrekMate_Backend_Source.zip',[(str(Path('brekmate-be')/p.relative_to(root)),p) for p in files])
manifest={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.glob('*.zip'))}
(out/'checksums.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
