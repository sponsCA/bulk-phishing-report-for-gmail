# -*- coding: utf-8 -*-
"""Generates the icon PNGs from the SVGs, with a headless Chromium browser and a temporary profile.

Usage: python icons/generate-png.py [browser path]
Without an argument, the browser is looked for among Google Chrome, Chromium and Microsoft Edge.
Each SVG is drawn on a canvas at its exact size; the PNG is read back from the DOM dumped by the browser.
"""
import base64, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
# PNG size -> source SVG (16 px: pixel-drawn version; 128 px: version with a margin).
SOURCES = {16: 'icon-16.svg', 32: 'icon.svg', 48: 'icon.svg', 128: 'icon-128.svg'}

COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge', 'microsoft-edge']
LOCATIONS = [
    os.path.join(os.environ.get(variable, ''), *path)
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA')
    for path in (('Google', 'Chrome', 'Application', 'chrome.exe'), ('Microsoft', 'Edge', 'Application', 'msedge.exe'))
    if os.environ.get(variable)
] + [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

def find_browser():
    if len(sys.argv) > 1:
        return sys.argv[1]
    for command in COMMANDS:
        if shutil.which(command):
            return shutil.which(command)
    for path in LOCATIONS:
        if os.path.isfile(path):
            return path
    raise SystemExit('No Chromium browser found: pass its path as an argument.')

def data_url(name):
    return 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(HERE, name), 'rb').read()).decode()

browser = find_browser()
tasks = ','.join(f'[{size}, "{data_url(name)}"]' for size, name in SOURCES.items())
page = f'''<!doctype html><meta charset="utf-8"><body><script>
Promise.all([{tasks}].map(([t, src]) => new Promise((ok) => {{
  const img = new Image();
  img.onload = () => {{
    const c = document.createElement('canvas'); c.width = c.height = t;
    c.getContext('2d').drawImage(img, 0, 0, t, t);
    const p = document.createElement('pre'); p.id = 'png-' + t; p.textContent = c.toDataURL('image/png');
    document.body.append(p); ok();
  }};
  img.src = src;
}})));
</script>'''

with tempfile.TemporaryDirectory() as folder:
    path = os.path.join(folder, 'render.html')
    open(path, 'w', encoding='utf-8').write(page)
    dom = subprocess.run(
        [browser, '--headless', '--disable-gpu', f'--user-data-dir={os.path.join(folder, "profile")}',
         '--virtual-time-budget=5000', '--dump-dom', 'file:///' + path.replace('\\', '/').lstrip('/')],
        capture_output=True, text=True, timeout=60).stdout

for size in SOURCES:
    found = re.search(rf'id="png-{size}">data:image/png;base64,([A-Za-z0-9+/=]+)<', dom)
    if not found:
        raise SystemExit(f'{size} px PNG not produced')
    open(os.path.join(HERE, f'icon-{size}.png'), 'wb').write(base64.b64decode(found.group(1)))
    print(f'icon-{size}.png')
