# Server files that import plain values (not components or hooks) from a "use client" module: undefined at run time.
import os,re
roots=['packages/ui/src','features','apps/school/src','apps/console/src']
files={}
for r in roots:
    for d,ds,fs in os.walk(r):
        ds[:]=[x for x in ds if x not in('node_modules','.next')]
        for f in fs:
            if f.endswith(('.ts','.tsx')) and '.test.' not in f: p=os.path.join(d,f); files[os.path.normpath(p)]=open(p).read()
client={p for p,s in files.items() if re.match(r'\s*["\']use client',s)}
def exp(s):
    return set(re.findall(r'export const ([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?!\(|async|function|memo|forwardRef|<)',s))
vals={p:exp(files[p]) for p in client}
def resolve(src,frm):
    if src.startswith('.'): base=os.path.normpath(os.path.join(os.path.dirname(frm),src))
    elif src.startswith('@smw/ui/'):
        k=src[8:]; m={'kit/':'packages/ui/src/components/dashboard/kit/','widgets/':'packages/ui/src/components/dashboard/widgets/','shell/':'packages/ui/src/shell/','finance/':'packages/ui/src/components/finance/','ui/':'packages/ui/src/components/ui/'}
        for a,b in m.items():
            if k.startswith(a): base=b+k[len(a):]; break
        else: return None
    elif src.startswith('@smw/feature-'):
        x=src[13:].split('/',1); base='features/'+x[0]+'/'+(x[1] if len(x)>1 else '')
    else: return None
    for e in('.tsx','.ts'):
        if os.path.normpath(base+e) in files: return os.path.normpath(base+e)
for p,s in files.items():
    if p in client: continue
    for m in re.finditer(r'import (type )?\{([^}]*)\} from "([^"]+)"',s):
        if m.group(1): continue
        t=resolve(m.group(3),p)
        if t in client:
            bad=[a.strip() for a in m.group(2).split(',') if a.strip() in vals[t] and not a.strip().startswith('type ')]
            if bad: print(p,'<-',t,bad)
