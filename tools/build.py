"""Assemble src/ into the self-contained index.html, and copy src/sw.js beside it."""
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
# the service worker that keeps card pictures on the device (src/sw.js):
# a file of its own, served beside index.html, copied as it is
sw = root / 'src' / 'sw.js'
if sw.exists():
    sw_out = out.with_name('sw.js')
    sw_out.write_text(sw.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
    print(f'wrote {sw_out} ({sw_out.stat().st_size:,} bytes)')
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
