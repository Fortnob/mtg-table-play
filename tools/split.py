"""One-time: split the single-file build back into its source modules."""
import re, json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
src.mkdir(exist_ok=True)
lines = (root / 'original.html').read_text(encoding='utf-8').split('\n')

def write(name, text):
    (src / name).write_text(text, encoding='utf-8', newline='\n')

style_open = next(i for i, l in enumerate(lines) if l.strip() == '<style>')
style_close = next(i for i, l in enumerate(lines) if l.strip() == '</style>')
script_open = max(i for i, l in enumerate(lines) if l.strip() == '<script>')
script_close = max(i for i, l in enumerate(lines) if l.strip() == '</script>')

write('head.html', '\n'.join(lines[:style_open]) + '\n')
write('style.css', '\n'.join(lines[style_open + 1:style_close]) + '\n')
write('body.html', '\n'.join(lines[style_close + 1:script_open]) + '\n')
write('tail.html', '\n'.join(lines[script_close + 1:]))

js = lines[script_open + 1:script_close]
marker = re.compile(r'^/\* ===== ([0-9a-z-]+\.js) ===== \*/$')
order, cur, buf = [], None, []
for l in js:
    m = marker.match(l)
    if m:
        if cur:
            write(cur, '\n'.join(buf) + '\n')
        cur, buf = m.group(1), []
        order.append(cur)
        continue
    buf.append(l)
write(cur, '\n'.join(buf) + '\n')
write('order.json', json.dumps(order, indent=1) + '\n')
print(order)
