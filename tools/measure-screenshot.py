# 真机截图像素测量：喇叭图标 vs 单词墨水中心；序号后间距
# 截图宽 513px = 设备全宽 = 750rpx → 1px(截图) = 750/513 = 1.462rpx
from PIL import Image
import sys

W_RPX = 750.0

def analyze(img_path, label):
    im = Image.open(img_path).convert('RGB')
    w, h = im.size
    px = im.load()
    scale = W_RPX / w  # rpx per screenshot px
    print(f'== {label} {w}x{h}, 1px = {scale:.3f} rpx')

    def is_green_ink(r, g, b):   # 喇叭绿 #176B5B / 加粗绿序号
        return g > r + 20 and g > b + 10 and g < 160 and r < 110

    def is_dark_ink(r, g, b):    # 单词黑墨
        return r < 110 and g < 110 and b < 110

    def vspan(x0, x1, y0, y1, pred):
        rows = []
        for y in range(y0, min(y1, h)):
            cnt = sum(1 for x in range(x0, min(x1, w)) if pred(*px[x, y]))
            if cnt >= 2:
                rows.append(y)
        if not rows: return None
        return rows[0], rows[-1], (rows[0]+rows[-1])/2

    def hspan(x0, x1, y0, y1, pred):
        cols = []
        for x in range(x0, min(x1, w)):
            cnt = sum(1 for y in range(y0, min(y1, h)) if pred(*px[x, y]))
            if cnt >= 1:
                cols.append(x)
        if not cols: return None
        return cols[0], cols[-1]

    return im, px, w, h, scale, is_green_ink, is_dark_ink, vspan, hspan

# ---------- 截图2：hello / goodbye / please 词行 ----------
im, px, w, h, scale, g_ink, d_ink, vspan, hspan = analyze(
    r'C:\Users\Administrator\.workbuddy\clipboard-images\clipboard-2026-09-25T18-31-42-979Z-b332ee1e.jpg', '词行截图')

# 找到词汇卡区域：喇叭在左侧 x≈38..62（按 513 宽）
SPK_X = (36, 64)
for word, (y0, y1) in [('hello', (640, 700)), ('goodbye', (738, 800)), ('please', (838, 900))]:
    spk = vspan(SPK_X[0], SPK_X[1], y0-25, y1+25, g_ink)
    # 单词墨水：x 从 75 到 165（hello）内黑色
    wrd = vspan(75, 168, y0-25, y1+25, d_ink)
    if spk and wrd:
        d = spk[2] - wrd[2]
        print(f'{word}: 喇叭y[{spk[0]},{spk[1]}]c={spk[2]:.1f}  词y[{wrd[0]},{wrd[1]}]c={wrd[2]:.1f}  '
              f'差={d:+.1f}px ({d*scale:+.1f}rpx)  {"喇叭偏低" if d>0 else "喇叭偏高"}')
    else:
        print(f'{word}: spk={spk} wrd={wrd}')

# 例句行右侧喇叭（Hello! Nice to meet you. 之后的行）
for label, (y0, y1) in [('ex-hello', (700, 730)), ('ex-goodbye', (798, 830)), ('ex-please', (898, 930))]:
    spk = vspan(405, 445, y0-10, y1+10, g_ink)
    txt = vspan(78, 400, y0-10, y1+10, d_ink)
    if spk and txt:
        d = spk[2] - txt[2]
        print(f'{label}: 喇叭c={spk[2]:.1f} 文c={txt[2]:.1f} 差={d:+.1f}px ({d*scale:+.1f}rpx) {"喇叭偏低" if d>0 else "喇叭偏高"}')
    else:
        print(f'{label}: spk={spk} txt={txt}')

# ---------- 截图1：语法区 1. 2. 3. 与练习区 1. 2. 3. ----------
im1, px1, w1, h1, scale1, g_ink1, d_ink1, vspan1, hspan1 = analyze(
    r'C:\Users\Administrator\.workbuddy\clipboard-images\clipboard-2026-09-25T18-31-42-969Z-5e956ee0.jpg', '序号截图')

# 语法区行（约 y 520..640, 序号 x 40..70, 正文起点 x ~75）
for label, (y0, y1) in [('语法1', (515, 545)), ('语法2', (565, 595)), ('语法3', (615, 645))]:
    no = hspan(38, 72, y0, y1, g_ink1)      # 序号墨水横向范围
    tx = hspan(72, 130, y0, y1, d_ink1)     # 正文首字符横向范围
    if no and tx:
        gap = tx[0] - no[1]
        print(f'{label}: 序号x[{no[0]},{no[1]}] 正文起x={tx[0]} 空隙={gap}px ({gap*scale1:.1f}rpx)')
    else:
        print(f'{label}: no={no} tx={tx}')

# 练习区行（约 y 740..830）
for label, (y0, y1) in [('练习1', (738, 768)), ('练习2', (778, 808)), ('练习3', (818, 848))]:
    no = hspan(38, 72, y0, y1, g_ink1)
    tx = hspan(72, 130, y0, y1, d_ink1)
    if no and tx:
        gap = tx[0] - no[1]
        print(f'{label}: 序号x[{no[0]},{no[1]}] 正文起x={tx[0]} 空隙={gap}px ({gap*scale1:.1f}rpx)')
    else:
        print(f'{label}: no={no} tx={tx}')

# 顺带量语法区行喇叭与句子的垂直关系
for label, (y0, y1) in [('语法行1', (515, 545)), ('语法行2', (565, 595))]:
    spk = vspan1(405, 445, y0-8, y1+8, g_ink1)
    txt = vspan1(75, 400, y0-8, y1+8, d_ink1)
    if spk and txt:
        d = spk[2] - txt[2]
        print(f'{label}: 喇叭c={spk[2]:.1f} 句c={txt[2]:.1f} 差={d:+.1f}px ({d*scale1:+.1f}rpx) {"喇叭偏低" if d>0 else "喇叭偏高"}')
    else:
        print(f'{label}: spk={spk} txt={txt}')
