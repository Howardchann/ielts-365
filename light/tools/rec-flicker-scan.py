#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rec-flicker-scan.py — 真机录屏逐帧闪烁扫描（v1.1.11 频闪验收用，09-26 定稿）
用法: python tools/rec-flicker-scan.py <录屏.mp4> [内容采样y1:y2] 
输出: 每个底色变化帧 + "内容/tabBar 深浅错位"帧清单（MISMATCH = 主题切换瞬间两层不同步）
原理: 三个区域各取中位色亮度 → L/D 二值 → 内容与 tabBar 状态不一致即错位帧。
      页面级白闪 = 深色稳态下内容区出现 L 帧；切 tab 闪 = 同主题下内容区颜色突变。
依赖: opencv-python numpy（隔离 venv 已装 cv2）
"""
import sys, cv2, numpy as np

def med(img):
    return tuple(int(x) for x in np.median(img.reshape(-1, 3), axis=0))

def lum(c):
    return 0.299 * c[2] + 0.587 * c[1] + 0.114 * c[0]

def state(v, th=110):
    return 'D' if v < th else 'L'   # 主题色都是深色系，阈值 110 可分

def main(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    # 采样带（按 640 宽录屏标定，其他分辨率按比例折算）
    y1, y2 = int(h*0.21), int(h*0.63)      # 页面内容主区
    ty1, ty2 = int(h*0.962), int(h*0.992)  # tabBar 背景带
    rows, i = [], 0
    while True:
        ok, f = cap.read()
        if not ok: break
        content = med(f[y1:y2, 0:int(w*0.05)])    # 左边距条 = 页面底色（避开卡片）
        tabbg   = med(f[ty1:ty2, int(w*0.01):int(w*0.11)])
        rows.append((i, state(lum(content)), state(lum(tabbg))))
        i += 1
    cap.release()
    print(f'frames={i} fps={fps:.1f} dur={i/fps:.1f}s  (C=内容 T=tabBar, L亮/D暗)')
    print('frame |  t(s) | C T | note')
    prev = None
    mm = 0
    for i, c, t in rows:
        note = ''
        if c != t:
            note = '  <<< MISMATCH (tabBar/内容错位 1 帧)'; mm += 1
        if prev != (c, t) or note:
            print(f'{i:5d} | {i/fps:5.2f} | {c} {t} |{note}')
        prev = (c, t)
    print(f'\n错位帧总数: {mm}  （每次主题切换允许 ≤1 帧 ≈{1000/fps:.0f}ms 属合成器级残留）')

if __name__ == '__main__':
    main(sys.argv[1])
