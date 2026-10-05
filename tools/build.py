"""Assemble src/ into the single self-contained index.html."""
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
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
