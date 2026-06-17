"""Generate 12 god portrait emblems as 32x32 palette-char grids.
Procedural pixel art on the game's shared palette. Emits a preview contact
sheet (to eyeball) and the TS content module src/game/content/godPortraits.ts."""
import json, math, io, os, tempfile, pathlib
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAL = json.load(open(f"{REPO}/content/palette.json"))["colors"]
PAL["."] = None  # transparent
N = 32
CX = CY = 15.5

def blank():
    return [["." for _ in range(N)] for _ in range(N)]

def px(g, x, y, c):
    xi, yi = int(round(x)), int(round(y))
    if 0 <= xi < N and 0 <= yi < N:
        g[yi][xi] = c

def disc(g, cx, cy, r, c):
    for y in range(N):
        for x in range(N):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                g[y][x] = c

def ring(g, cx, cy, r, c, th=1.2):
    for y in range(N):
        for x in range(N):
            d = math.hypot(x - cx, y - cy)
            if r - th <= d <= r:
                g[y][x] = c

def ellipse(g, cx, cy, rx, ry, c):
    for y in range(N):
        for x in range(N):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                g[y][x] = c

def rect(g, x0, y0, x1, y1, c):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            px(g, x, y, c)

def line(g, x0, y0, x1, y1, c, th=1):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        for dx in range(-(th // 2), th - th // 2):
            for dy in range(-(th // 2), th - th // 2):
                px(g, x + dx, y + dy, c)

def mirror(g):
    """mirror left half onto right for symmetric emblems"""
    for y in range(N):
        for x in range(N // 2):
            g[y][N - 1 - x] = g[y][x]

def medallion(bg, rim="0", inner=None):
    g = blank()
    disc(g, CX, CY, 15, bg)
    if inner:
        ring(g, CX, CY, 13.5, inner, 1.2)
    ring(g, CX, CY, 15, rim, 1.4)
    return g

# ---------------- the 12 gods ----------------

def war():  # crossed steel swords, gold guards, on dark red
    g = medallion("R", inner="r")
    for sign in (1, -1):
        # blade from lower-inner to upper-outer
        line(g, 16 - sign * 7, 23, 16 + sign * 7, 8, "6", 3)
        line(g, 16 - sign * 7, 23, 16 + sign * 7, 8, "7", 1)
        px(g, 16 + sign * 7, 8, "W"); px(g, 16 + sign * 7 - sign, 9, "W")  # tip
    # gold guards + grips crossing low-center
    rect(g, 11, 21, 20, 22, "y")
    line(g, 9, 24, 13, 20, "Y", 2)
    line(g, 22, 24, 18, 20, "Y", 2)
    px(g, 9, 25, "y"); px(g, 22, 25, "y")
    return g

def trickster():  # harlequin domino mask
    g = medallion("V", inner="v")
    ellipse(g, CX, 15, 11, 6, "w")
    # eye holes (slanted)
    for cx2 in (11, 20):
        ellipse(g, cx2, 14, 2.4, 1.6, "0")
    # mask points top + jingle
    for cx2, c in ((8, "y"), (23, "p")):
        line(g, cx2, 9, cx2, 6, c, 1); px(g, cx2, 5, c)
    rect(g, 14, 18, 17, 19, "p")  # smirk
    return g

def poultry():  # regal hen head
    g = medallion("T", inner="t")
    ellipse(g, CX, 17, 8, 8, "w")            # head/body
    ellipse(g, CX, 11, 5, 3, "w")            # crown of head
    for dx in (-3, 0, 3):                     # red comb
        ellipse(g, CX + dx, 7, 2, 2.4, "r")
    line(g, 20, 16, 25, 17, "o", 2); px(g, 26, 17, "o")  # beak
    rect(g, 14, 14, 15, 15, "0"); rect(g, 18, 14, 19, 15, "0")  # eyes
    rect(g, 13, 23, 18, 25, "r")             # wattle
    return g

def ledger():  # account book + gold coin
    g = medallion("K", inner="k")
    rect(g, 8, 9, 23, 24, "N")     # cover
    rect(g, 9, 10, 22, 23, "w")    # pages
    rect(g, 15, 9, 16, 24, "n")    # spine
    for yy in (12, 14, 16, 18, 20):  # ledger lines
        rect(g, 10, yy, 14, yy, "4"); rect(g, 17, yy, 21, yy, "4")
    disc(g, 21, 21, 4, "y"); ring(g, 21, 21, 4, "Y", 1.1)  # coin
    px(g, 20, 20, "w")
    return g

def mushroom():  # spotted toadstool
    g = medallion("G", inner="g")
    ellipse(g, CX, 14, 11, 7, "R")    # cap underside dark
    ellipse(g, CX, 13, 11, 6.5, "r")  # cap
    for sx, sy, sr in ((10, 11, 2), (16, 9, 2.4), (22, 12, 2), (13, 15, 1.4), (20, 15, 1.5)):
        disc(g, sx, sy, sr, "W")      # spots
    rect(g, 13, 18, 18, 26, "w")      # stem
    ellipse(g, CX, 26, 4, 1.6, "f")
    rect(g, 13, 18, 18, 19, "f")      # gills shadow
    return g

def money():  # fat gold coin with a smug face
    g = medallion("Y", inner="o")
    disc(g, CX, CY, 11, "y")
    ring(g, CX, CY, 11, "Y", 1.4)
    ring(g, CX, CY, 8.5, "w", 1.0)
    rect(g, 12, 13, 13, 15, "Y"); rect(g, 18, 13, 19, 15, "Y")  # eyes
    line(g, 12, 19, 19, 19, "Y", 1); px(g, 12, 18, "Y"); px(g, 19, 18, "Y")  # smug smile
    px(g, 11, 11, "W"); px(g, 12, 11, "W")  # shine
    return g

def death():  # calm skull
    g = medallion("V", inner="v")
    ellipse(g, CX, 14, 8, 8, "w")     # cranium
    rect(g, 11, 20, 20, 24, "w")      # jaw
    ellipse(g, 12, 14, 2.6, 3, "0")   # eye sockets
    ellipse(g, 19, 14, 2.6, 3, "0")
    rect(g, 15, 17, 16, 19, "0")      # nose
    for x in (12, 14, 16, 18):        # teeth gaps
        rect(g, x, 21, x, 24, "5")
    return g

def sun():  # radiant sun, all-seeing eye
    g = medallion("B", inner="b")
    for a in range(0, 360, 30):       # rays
        rad = math.radians(a)
        x = CX + math.cos(rad) * 13.5
        y = CY + math.sin(rad) * 13.5
        line(g, CX + math.cos(rad) * 9, CY + math.sin(rad) * 9, x, y, "y", 2)
    disc(g, CX, CY, 8, "y")
    ring(g, CX, CY, 8, "o", 1.2)
    ellipse(g, CX, CY, 4.5, 2.6, "w")  # eye white
    disc(g, CX, CY, 1.8, "b")          # iris
    px(g, CX, CY, "0")
    return g

def storm():  # bolt over a cloud
    g = medallion("B", inner="b")
    for cx2, cy2, r in ((11, 13, 5), (17, 11, 6), (22, 14, 5), (15, 16, 6)):
        disc(g, cx2, cy2, r, "5")
    ring(g, 16, 14, 8, "6", 1.0)
    # lightning bolt
    pts = [(17, 11), (13, 19), (16, 19), (12, 27), (20, 17), (16, 17), (19, 11)]
    for i in range(len(pts) - 1):
        line(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], "y", 2)
    disc(g, 15, 21, 3, "y"); disc(g, 15, 21, 1.5, "W")
    return g

def moon():  # crescent + half-closed eye
    g = medallion("K", inner="v")
    disc(g, 14, 15, 10, "q")          # full disc
    disc(g, 19, 13, 9, "K")           # bite -> crescent
    # sleepy eye on the crescent
    line(g, 9, 15, 14, 15, "0", 1)
    ellipse(g, 11.5, 16, 2, 1.4, "b")
    px(g, 11, 13, "W")
    return g

def glutton():  # drumstick
    g = medallion("N", inner="n")
    ellipse(g, 13, 13, 7, 7, "O")     # meat
    ring(g, 13, 13, 7, "n", 1.0)
    ellipse(g, 11, 11, 2.5, 2, "m")   # highlight
    line(g, 17, 17, 25, 25, "w", 4)   # bone
    disc(g, 25, 25, 2.4, "w"); disc(g, 24, 26, 2.0, "w")
    disc(g, 26, 24, 2.0, "f")
    return g

def bee():  # crowned queen bee, top-down
    g = medallion("Y", inner="o")
    # wings: tall pale ovals set high and out to the sides (behind body)
    for wx in (8, 23):
        ellipse(g, wx, 12, 4, 6, "6")
        ellipse(g, wx, 12, 3, 5, "c")
        ellipse(g, wx, 11, 1.3, 2.6, "W")
    # striped body (dark rim so stripes read on the gold medallion)
    ellipse(g, CX, 19, 5.6, 7.8, "0")
    ellipse(g, CX, 19, 5, 7.2, "y")
    for yy in (15, 19, 23):
        rect(g, 11, yy, 20, yy + 1, "0")
    px(g, 15, 26, "0"); px(g, 16, 26, "0"); px(g, 15, 27, "0")  # stinger
    # head + antennae
    disc(g, CX, 9, 3, "0")
    line(g, 14, 7, 12, 3, "0", 1); px(g, 12, 3, "y")
    line(g, 17, 7, 19, 3, "0", 1); px(g, 19, 3, "y")
    # queen's crown
    rect(g, 12, 5, 19, 6, "y")
    for cx2 in (12, 15, 18):
        px(g, cx2, 4, "w")
    return g

GODS = [
    ("war_god", war), ("trickster_god", trickster), ("poultry_god", poultry),
    ("debt_god", ledger), ("mushroom_god", mushroom), ("money_god", money),
    ("death_god", death), ("sun_god", sun), ("storm_god", storm),
    ("moon_god", moon), ("glutton_god", glutton), ("bee_god", bee),
]

# ---------------- render contact sheet ----------------
def to_rows(g):
    return ["".join(r) for r in g]

def render(g, zoom):
    img = Image.new("RGBA", (N * zoom, N * zoom), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(N):
        for x in range(N):
            c = g[y][x]
            hexv = PAL.get(c)
            if hexv:
                r = int(hexv[1:3], 16); gg = int(hexv[3:5], 16); b = int(hexv[5:7], 16)
                d.rectangle([x * zoom, y * zoom, (x + 1) * zoom - 1, (y + 1) * zoom - 1], fill=(r, gg, b, 255))
    return img

grids = {gid: fn() for gid, fn in GODS}

cols, rows, zoom, pad, lbl = 4, 3, 7, 12, 16
cellw, cellh = N * zoom + pad * 2, N * zoom + pad + lbl
sheet = Image.new("RGBA", (cols * cellw, rows * cellh), (24, 20, 30, 255))
dd = ImageDraw.Draw(sheet)
for i, (gid, _) in enumerate(GODS):
    cxp = (i % cols) * cellw + pad
    cyp = (i // cols) * cellh + pad
    sheet.paste(render(grids[gid], zoom), (cxp, cyp), render(grids[gid], zoom))
    dd.text((cxp, cyp + N * zoom + 2), gid, fill=(230, 230, 240, 255))
PREVIEW = os.path.join(tempfile.gettempdir(), "god-portraits-preview.png")
sheet.save(PREVIEW)
print("preview ->", PREVIEW)

# ---------------- emit TS ----------------
ts = ['/**',
      ' * 32x32 pixel-art god portraits, one per religion id. Palette-char rows',
      " * (content/palette.json); '.' is transparent. Rendered DOM-side by the",
      ' * <GodPortrait> component. Generated by tools/gen-god-portraits.py (Python 3.13 + Pillow).',
      ' */',
      'export const GOD_PORTRAITS: Record<string, string[]> = {']
for gid, _ in GODS:
    ts.append(f'  {gid}: [')
    for row in to_rows(grids[gid]):
        ts.append(f"    '{row}',")
    ts.append('  ],')
ts.append('};')
open(f"{REPO}/src/game/content/godPortraits.ts", "w").write("\n".join(ts) + "\n")
print("wrote src/game/content/godPortraits.ts")
