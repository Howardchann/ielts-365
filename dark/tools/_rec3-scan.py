import cv2, numpy as np, sys, os

cap = cv2.VideoCapture('_rec3.mp4')
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
idx = 0
prev = None
while True:
    ok, f = cap.read()
    if not ok: break
    g = cv2.cvtColor(cv2.resize(f,(120,260)), cv2.COLOR_BGR2GRAY).astype(np.int16)
    d = 0 if prev is None else int(np.abs(g-prev).mean())
    frames.append((idx, d, f))
    prev = g
    idx += 1
cap.release()
print('total frames', idx, 'fps', fps, 'dur %.1fs' % (idx/fps))

# 突变帧（转场候选）
spikes = [(i,d) for i,d,_ in frames if d > 18]
print('spike frames:', [(i,d) for i,d in spikes][:40])

# 导出每个突变点前后各5帧缩略图
os.makedirs('_rec3_frames', exist_ok=True)
shown = set()
for i,d in spikes:
    for k in range(max(0,i-4), min(idx,i+6)):
        if k in shown: continue
        shown.add(k)
        f = frames[k][2]
        cv2.imwrite(f'_rec3_frames/f{k:04d}_d{int(frames[k][1]):03d}.png', cv2.resize(f,(300,650)))
print('exported', len(shown), 'frames to _rec3_frames/')
