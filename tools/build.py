"""Assemble src/ into the self-contained index.html, and copy the files served
beside it: the service worker (src/sw.js), the web app manifest and its icons."""
import json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
order = json.loads((src / 'order.json').read_text(encoding='utf-8'))

def read(name):
    t = (src / name).read_text(encoding='utf-8')
    return t[:-1] if t.endswith('\n') else t

styles = json.loads((src / 'styles.json').read_text(encoding='utf-8')) if (src / 'styles.json').exists() else ['style.css']
parts = [read('head.html'), '<style>', '\n'.join(read(s) for s in styles), '</style>', read('body.html'), '<script>']
for name in order:
    parts.append(f'/* ===== {name} ===== */')
    parts.append(read(name))
parts.append('</script>')
parts.append((src / 'tail.html').read_text(encoding='utf-8'))
out = root / (sys.argv[1] if len(sys.argv) > 1 else 'index.html')
out.write_text('\n'.join(parts), encoding='utf-8', newline='\n')
# files of their own, served beside index.html and copied as they are: the
# service worker that keeps card pictures and the page on the device, and
# the manifest and icons a phone's home screen uses
for name in ('sw.js', 'manifest.webmanifest'):
    f = root / 'src' / name
    if f.exists():
        f_out = out.with_name(name)
        f_out.write_text(f.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
        print(f'wrote {f_out} ({f_out.stat().st_size:,} bytes)')
icons = root / 'src' / 'icons'
if icons.is_dir():
    icons_out = out.parent / 'icons'
    icons_out.mkdir(exist_ok=True)
    for f in sorted(icons.glob('*.png')):
        (icons_out / f.name).write_bytes(f.read_bytes())
    print(f'wrote {icons_out} ({len(list(icons.glob("*.png")))} icons)')
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
