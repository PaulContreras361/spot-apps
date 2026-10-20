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


TILE = {
    'fish': ('#1E5A68', 'Salt &amp; Fresh', 'Tides · Wind · Bite', 'The weekly hotspots', '48 weeks of Texas hotspots, salt and fresh, with live tides, wind and the best bite times. Log your catches on the Brag Board.'),
    'deer': ('#C4361C', 'Whitetail', 'Rut · Season · Stands', 'Read the rut', 'Rut report for 8 Texas regions, the 2026–27 season clock, and a stand map that picks the right stand for the wind.'),
    'bird': ('#8A6FB0', 'Game Birds', 'Dove · Duck · Goose', 'Every bird, every week', 'Dove, ducks, geese, quail, turkey and more — season dates, zones and live weather for the hunt.'),
}


def start_page(name, apps):
    import html, math
    t = open(os.path.join(ROOT, 'tools', 'start.html'), encoding='utf8').read()
    tiles = ''
    for a in apps:
        c, kick, right, em, blurb = TILE[a]
        tiles += (f'    <a class="app" href="{a}/" style="--c:{c}"><div class="ph" style="background-image:url(../../tools/tiles/{a}.jpg)">'
                  f'<small><span>{kick}</span><span>{right}</span></small><h2>{NAMES[a]}<em>{em}</em></h2></div>'
                  f'<div class="bd"><p>{blurb}</p><span class="go">Open <span>&rarr;</span></span></div></a>\n')
    pts = ' '.join(f'{50 + (40 if i % 2 else 50) * math.cos(math.pi * i / 18):.1f},{50 + (40 if i % 2 else 50) * math.sin(math.pi * i / 18):.1f}' for i in range(36))
    words = {2: 'TWO', 3: 'THREE'}
    return (t.replace('TILES_HTML', tiles.rstrip('\n')).replace('TILES/', '../../tools/tiles/')
             .replace('BURST', pts).replace('>COUNT<', '>' + str(len(apps)) + '<')
             .replace('NAME', html.escape(name)))


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
    if len(apps) > 1:   # bundle: a magazine-cover start page with all their apps
        open(os.path.join(ROOT, 'b', folder, 'index.html'), 'w', encoding='utf8').write(start_page(name, apps))
    link = SITE + f'b/{folder}/' + ('' if len(apps) > 1 else apps[0] + '/')
    print(json.dumps({'name': name, 'code': code, 'link': link, 'folder': folder, 'apps': apps}))


if __name__ == '__main__':
    main()
