import cv2, numpy as np, os

cap = cv2.VideoCapture('_rec4.mp4')
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

spikes = [(i,d) for i,d,_ in frames if d > 18]
print('spike frames:', [(i,d) for i,d in spikes][:60])

# 三个横带亮度：顶(导航/状态栏区) 中(内容) 底(tabBar) —— 判断白闪在哪一层
def bands(f):
    h = f.shape[0]
    out = []
    for name, sl in [('top', f[0:int(h*0.14)]), ('mid', f[int(h*0.3):int(h*0.7)]), ('bot', f[int(h*0.88):])]:
        out.append('%s=%3d' % (name, int(cv2.cvtColor(sl, cv2.COLOR_BGR2GRAY).mean())))
    return ' '.join(out)

for i, d in spikes:
    print('--- spike f%d d=%d' % (i, d))
    for k in range(max(0, i-3), min(idx, i+4)):
        print('   f%04d d=%3d  %s' % (k, frames[k][1], bands(frames[k][2])))

os.makedirs('_rec4_frames', exist_ok=True)
shown = set()
for i, d in spikes:
    for k in range(max(0,i-4), min(idx,i+6)):
        if k in shown: continue
        shown.add(k)
        f = frames[k][2]
        cv2.imwrite(f'_rec4_frames/f{k:04d}_d{int(frames[k][1]):03d}.png', cv2.resize(f,(300,650)))
print('exported', len(shown), 'frames to _rec4_frames/')
