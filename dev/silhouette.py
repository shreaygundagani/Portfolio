"""Compare the bag's silhouette with the reference photo, numerically.

For each image: mask the dark (bag) pixels against the light backdrop, take
the left/right envelope per row, normalise height (handle top -> base) and
width (base width), then compare width profiles. Writes an overlay image.
"""
import sys
from PIL import Image, ImageDraw

def envelope(path, y_from, thresh=105):
    im = Image.open(path).convert('L')
    W, H = im.size
    px = im.load()
    rows = {}
    for y in range(y_from, H):
        xs = [x for x in range(W) if px[x, y] < thresh]
        if len(xs) >= 2:
            rows[y] = (xs[0], xs[-1])
    ys = sorted(rows)
    # the base: last row with a substantial run of dark pixels
    bottom = max(y for y in ys if rows[y][1] - rows[y][0] > W * 0.12)
    top = ys[0]
    return rows, top, bottom, im.size

def profile(rows, top, bottom, n=40):
    # base width = widest extent in the lowest 25%
    lo = [rows[y] for y in rows if y >= top + 0.75 * (bottom - top) and y <= bottom]
    base = max(r[1] - r[0] for r in lo)
    cx = sum((r[0] + r[1]) / 2 for r in lo) / len(lo)
    out = []
    for k in range(n + 1):
        t = k / n
        y = round(top + t * (bottom - top))
        while y not in rows and y < bottom: y += 1
        l, r = rows.get(y, (cx, cx))
        out.append(((l - cx) / base, (r - cx) / base, (r - l) / base))
    return out, base, cx

ref_path, ours_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
# rows above these are the hand (reference) / nothing (ours)
ref_rows, rt, rb, rs = envelope(ref_path, 172)
our_rows, ot, ob, os_ = envelope(ours_path, 0)
rp, rbase, rcx = profile(ref_rows, rt, rb)
op, obase, ocx = profile(our_rows, ot, ob)

print(f'reference: top {rt} base {rb} base-width {rbase}px  aspect H/W {(rb - rt) / rbase:.2f}')
print(f'ours:      top {ot} base {ob} base-width {obase}px  aspect H/W {(ob - ot) / obase:.2f}')
diffs = []
print(' t    ref-width  our-width   diff')
for k in range(0, len(rp), 4):
    t = k / (len(rp) - 1)
    print(f'{t:4.2f}   {rp[k][2]:6.2f}     {op[k][2]:6.2f}   {op[k][2] - rp[k][2]:+5.2f}')
for k in range(len(rp)):
    t = k / (len(rp) - 1)
    if t >= 0.35:  # below the knot: the net itself
        diffs.append(abs(op[k][2] - rp[k][2]))
print(f'mean |width difference| over the net (t >= 0.35): {sum(diffs) / len(diffs):.3f} of base width')

# overlay: both outlines at the same height / base width
S = 600
img = Image.new('RGB', (S, int(S * 1.25)), (245, 245, 240))
d = ImageDraw.Draw(img)
def draw(p, colour):
    H = img.height - 60
    pts_l = [(S / 2 + l * 300, 30 + (k / (len(p) - 1)) * H) for k, (l, r, w) in enumerate(p)]
    pts_r = [(S / 2 + r * 300, 30 + (k / (len(p) - 1)) * H) for k, (l, r, w) in enumerate(p)]
    d.line(pts_l, fill=colour, width=3)
    d.line(pts_r, fill=colour, width=3)
draw(rp, (200, 40, 40))
draw(op, (40, 70, 200))
d.text((14, 8), 'red = reference photo   blue = render (same height & base width)', fill=(30, 30, 30))
img.save(out_path)
