#!/usr/bin/env python3
"""
Make a buyer's private web copy of the Spot apps (Etsy edition).

    python3 tools/stamp_web.py "Buyer Name" 12345678 fish
    python3 tools/stamp_web.py "Buyer Name" 12345678 fish deer bird   (bundle)

- The unlock code is the last 4 digits of the Etsy order number.
- The order number itself is NOT written into the page; only a scrambled
  fingerprint of name + private folder + code.
- Pages go to b/<random folder>/<app>/ and are marked "do not index".
- Nothing is logged here (this site is public). Keep the printed line in your own records.

Templates live in tools/templates/ and are locked with a code nobody has,
so opening a template in a browser shows the lock screen and nothing else.
"""
import json, os, re, secrets, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = {'fish': 'my-fishing-spot.html', 'deer': 'my-deer-spot.html', 'bird': 'my-bird-spot.html'}
NAMES = {'fish': 'My Fishing Spot', 'deer': 'My Deer Spot', 'bird': 'My Bird Spot'}
SITE = 'https://paulcontreras361.github.io/spot-apps/'


def lock_hash(s):
    """Same fingerprint the apps use (lockHash in the page)."""
    h1, h2 = 0x811c9dc5, 0x9e3779b1
    for _ in range(2000):
        for ch in s:
            c = ord(ch)
            h1 = ((h1 ^ c) * 16777619) & 0xFFFFFFFF
            h2 = ((h2 ^ c) * 2246822519) & 0xFFFFFFFF
        s = to36(h1) + '.' + to36(h2)
    return s


def to36(n):
    d = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        n, r = divmod(n, 36)
        out = d[r] + out
        if n == 0:
            return out


def stamp(html, lic):
    new = '/*@LICENSE@*/const LICENSE=' + json.dumps(lic, ensure_ascii=False) + ';/*@END_LICENSE@*/'
    out, n = re.subn(r'/\*@LICENSE@\*/.*?/\*@END_LICENSE@\*/', lambda m: new, html, flags=re.S)
    assert n == 1, 'license slot not found'
    if '<meta name="robots"' not in out:
        out = out.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex,nofollow">', 1)
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__); sys.exit(1)
    name, order, apps = sys.argv[1].strip(), re.sub(r'\D', '', sys.argv[2]), sys.argv[3:]
    assert name and len(order) >= 4, 'need a name and an order number'
    assert all(a in TPL for a in apps), 'apps must be fish, deer or bird'
    code = order[-4:]
    folder = secrets.token_urlsafe(9).replace('-', 'x').replace('_', 'y')
    lic = {'name': name, 'order': folder, 'lock': lock_hash(f'{name}|{folder}|{code}'), 'apps': apps}
    for a in apps:
        src = open(os.path.join(ROOT, 'tools', 'templates', TPL[a]), encoding='utf8').read()
        d = os.path.join(ROOT, 'b', folder, a)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'index.html'), 'w', encoding='utf8').write(stamp(src, lic))
    if len(apps) > 1:   # bundle: a small start page with all their apps
        links = ''.join(f'<a href="{a}/">{NAMES[a]} →</a>' for a in apps)
        page = ('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow">'
                '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Spot Apps</title><style>'
                'body{margin:0;min-height:100vh;background:#14110D;color:#F4EDDD;font:17px/1.5 Georgia,serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}'
                '.w{max-width:420px;width:100%;text-align:center}h1{font-size:34px;margin:0 0 4px}p{color:#CBBF9F;margin:0 0 18px}'
                'a{display:block;margin:10px 0;padding:14px;border-radius:4px;background:#F4EDDD;color:#1C1A16;text-decoration:none;font-weight:700}'
                '</style></head><body><div class="w"><h1>Your Spot Apps</h1>'
                f'<p>Licensed to {name}. One code opens all of them.</p>{links}</div></body></html>')
        open(os.path.join(ROOT, 'b', folder, 'index.html'), 'w', encoding='utf8').write(page)
    link = SITE + f'b/{folder}/' + ('' if len(apps) > 1 else apps[0] + '/')
    print(json.dumps({'name': name, 'code': code, 'link': link, 'folder': folder, 'apps': apps}))


if __name__ == '__main__':
    main()
