#!/usr/bin/env python3
import argparse, hashlib, json, shutil, uuid
from datetime import datetime, timezone
from pathlib import Path

def digest(path):
 h=hashlib.sha256(); count=0
 for f in sorted(x for x in path.rglob('*') if x.is_file()):
  h.update(f.relative_to(path).as_posix().encode()); h.update(f.read_bytes()); count+=1
 return count,h.hexdigest()
def main():
 p=argparse.ArgumentParser(); p.add_argument('--project-root',required=True); p.add_argument('--reason',required=True); a=p.parse_args(); root=Path(a.project_root).resolve(); out=root/'_output'; dst=out/'logs'/'archive'/f"run_{datetime.now(timezone.utc):%Y%m%d_%H%M%S_%f}_{uuid.uuid4().hex[:8]}"; dst.mkdir(parents=True)
 entries=[]
 try:
  for name in ('diagrams','db_table_mapped'):
   src=out/name; entry={'path':name,'present':src.is_dir()}
   if src.is_dir():
    shutil.copytree(src,dst/name); sc,sh=digest(src); dc,dh=digest(dst/name)
    if (sc,sh)!=(dc,dh): raise RuntimeError(f'archive integrity mismatch for {name}')
    entry.update({'sourceFileCount':sc,'sourceSha256':sh,'archiveFileCount':dc,'archiveSha256':dh})
   else: entry['state']='absent_before_first_generation'
   entries.append(entry)
  (dst/'manifest.json').write_text(json.dumps({'reason':a.reason,'createdAt':datetime.now(timezone.utc).isoformat(),'entries':entries},indent=2),encoding='utf8')
 except Exception as e:
  shutil.rmtree(dst,ignore_errors=True); raise SystemExit(f'backup failed: {e}')
 print(dst)
if __name__=='__main__': main()
