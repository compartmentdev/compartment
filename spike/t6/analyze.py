#!/usr/bin/env python3
import re,sys

run=sys.argv[1]
paths=sys.argv[2:]
for path in paths:
    ids=[]
    try:
        for line in open(path,errors='replace'):
            match=re.search(rf'T6\|{re.escape(run)}\|(\d+)',line)
            if match: ids.append(int(match.group(1)))
    except FileNotFoundError: pass
    unique=set(ids); maximum=max(unique,default=0)
    missing=[i for i in range(1,maximum+1) if i not in unique]
    print(f'{path}: max={maximum} unique={len(unique)} duplicates={len(ids)-len(unique)} missing_to_max={len(missing)} first_missing={missing[:10]}')
