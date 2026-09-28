"""Build portfolio.html/pdf/preview.png from README, EVIDENCE and ROADMAP (needs Google Chrome)."""
import html, re, subprocess
from pathlib import Path

def md(t):
    out, para = [], []
    inlist = intable = incode = False
    def flush():
        nonlocal para
        if para:
            out.append('<p>' + ' '.join(para) + '</p>')
            para = []
    for line in t.split('\n'):
        if line.startswith('```'):
            flush(); out.append('</pre>' if incode else '<pre>'); incode = not incode; continue
        if incode:
            out.append(html.escape(line)); continue
        s = html.escape(line)
        s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
        s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
        s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)
        if line.startswith('|'):
            flush(); cells = [c.strip() for c in s.strip('|').split('|')]
            if all(re.fullmatch(r':?-+:?', c) for c in cells):
                continue
            tag = 'td' if intable else 'th'
            if not intable:
                out.append('<table>'); intable = True
            out.append('<tr>' + ''.join(f'<{tag}>{c}</{tag}>' for c in cells) + '</tr>'); continue
        elif intable:
            out.append('</table>'); intable = False
        if re.match(r'^(- |\d+\. )', line):
            flush()
            if not inlist:
                out.append('<ul>'); inlist = True
            out.append('<li>' + re.sub(r'^(- |\d+\. )', '', s) + '</li>'); continue
        if inlist and line.startswith('  ') and line.strip():
            out[-1] = out[-1][:-5] + ' ' + s.strip() + '</li>'; continue
        if inlist and not line.startswith('  '):
            out.append('</ul>'); inlist = False
        m = re.match(r'^(#{1,4}) (.*)', s)
        if m:
            flush(); out.append(f'<h{len(m.group(1))}>{m.group(2)}</h{len(m.group(1))}>'); continue
        if s.startswith('&gt; '):
            flush(); out.append('<blockquote>' + s[5:] + '</blockquote>'); continue
        if s.strip():
            para.append(s)
        else:
            flush()
    flush()
    if inlist: out.append('</ul>')
    if intable: out.append('</table>')
    return '\n'.join(out)

root = Path(__file__).resolve().parent.parent
body = ''.join(md((root / f).read_text()) for f in ['README.md', 'EVIDENCE.md', 'ROADMAP.md'])
css = ("body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;font-size:10pt;line-height:1.45;margin:15mm;color:#111}"
       "h1{font-size:16pt;border-bottom:2px solid #333}h2{font-size:12.5pt;margin-top:12px}h3{font-size:11pt;margin:10px 0 4px}"
       "blockquote{border-left:4px solid #3b6;background:#f3faf5;margin:8px 0;padding:6px 10px}"
       "table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #bbb;padding:3px 5px;font-size:9pt;vertical-align:top}"
       "th{background:#eee}code{background:#f2f2f2;padding:0 2px;font-size:8.5pt}pre{background:#f6f6f6;padding:6px;font-size:8.5pt}li{margin:2px 0}")
(root / 'portfolio.html').write_text(f"<!doctype html><html lang='ko'><meta charset='utf-8'><title>Agentic Coding System Portfolio</title><style>{css}</style><body>{body}</body></html>")
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
url = (root / 'portfolio.html').as_uri()
subprocess.run([chrome, '--headless', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={root / "portfolio.pdf"}', url], capture_output=True)
subprocess.run([chrome, '--headless', '--disable-gpu', '--hide-scrollbars', '--window-size=900,1500', f'--screenshot={root / "preview.png"}', url], capture_output=True)
print('built', root / 'portfolio.pdf')
