#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""临时分析脚本：全量白光尖峰检测（不限主题切换时刻，覆盖普通切页）
判据：内容条带亮度出现 ≤3 帧的局部尖峰（比两侧稳态高 40+，且两侧稳态一致）
     ——即"闪一下又回去"，与"切换后停留在新底色"的合法过渡区分开。
"""
import sys, os, cv2, numpy as np

def med(img):
    return tuple(int(x) for x in np.median(img.reshape(-1, 3), axis=0))

def lum(c):
    return 0.299 * c[2] + 0.587 * c[1] + 0.114 * c[0]

def main(path, outdir):
    os.makedirs(outdir, exist_ok=True)
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    y1, y2 = int(h*0.21), int(h*0.63)
    ty1, ty2 = int(h*0.962), int(h*0.992)
    L, T, frames = [], [], []
    while True:
        ok, f = cap.read()
        if not ok: break
        c = med(f[y1:y2, 0:int(w*0.05)])
        t = med(f[ty1:ty2, int(w*0.01):int(w*0.11)])
        L.append(lum(c)); T.append(lum(t)); frames.append(f)
    cap.release()
    n = len(L)
    print(f'frames={n} fps={fps:.1f} size={w}x{h} dur={n/fps:.1f}s')

    def stable_base(i, side):
        # 取该侧 3~10 帧前的中位亮度（避开过渡带）
        vals = []
        for d in range(3, 11):
            j = i + d*side
            if 0 <= j < n: vals.append(L[j])
        return float(np.median(vals)) if vals else L[i]

    flashes = []
    i = 2
    while i < n-2:
        baseL, baseR = stable_base(i, -1), stable_base(i, 1)
        if abs(baseL-baseR) < 15 and L[i]-max(baseL, baseR) > 40:
            # 尖峰长度
            j = i
            while j < n-1 and L[j]-max(baseL, baseR) > 40: j += 1
            run = j-i
            if run <= 3:
                flashes.append((i, run, baseL, baseR, [round(L[k]) for k in range(max(0,i-2), min(n,i+run+2))]))
            i = j+1
        else:
            i += 1

    print(f'\n白光尖峰: {len(flashes)} 处')
    tiles = []
    for fi, run, bl, br, ctx in flashes:
        print(f'  frame {fi} t={fi/fps:.2f}s run={run} baseL={bl:.0f} baseR={br:.0f} ctx={ctx}')
        f = frames[fi].copy()
        cv2.rectangle(f, (0, y1), (int(w*0.05), y2), (0, 0, 255), 6)
        cv2.putText(f, f'f{fi} {fi/fps:.2f}s', (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0,0,255), 5)
        tiles.append(cv2.resize(f, (360, 800)))
    if tiles:
        sheet = np.hstack(tiles[:8])
        cv2.imwrite(os.path.join(outdir, '_flash-proof.png'), sheet)
        print('proof ->', os.path.join(outdir, '_flash-proof.png'))

    # 深色稳态下的亮帧（主题为暗但内容条亮，含错位）
    mism = [(i, round(L[i]), round(T[i])) for i in range(n) if abs(L[i]-T[i]) > 60]
    print(f'\n内容/tabBar 大亮度差帧: {len(mism)}')
    for i, l, t in mism[:30]:
        print(f'  frame {i} t={i/fps:.2f}s C={l} T={t}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '.')
