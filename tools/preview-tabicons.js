// 用户确认页：从落盘 wxss 抽取真实图标 + 重建上一版有 bug 的路径做对比。
const fs = require('fs');
const path = require('path');
const wxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.wxss'), 'utf8');
const enc2 = s => encodeURIComponent(s).replace(/'/g, '%27');
function uri(key, on) {
  const m = wxss.match(new RegExp(`\\.i-${key}${on ? '\\.on' : '(?![-.\\w])'}\\{background-image:url\\("data:image/svg\\+xml,([^"]+)"\\)\\}`));
  if (!m) throw new Error('not found: ' + key + (on ? '.on' : ''));
  return decodeURIComponent(m[1]);
}
const RED = '#D85A30', GREEN = '#176B5B', SW = "stroke-width='1.8' fill='none'";
// 上一版 bug 路径（sweep 标志错误 → SVG 换候选圆心画成碎弧；箭头一臂伸出半径外）
const oldBroken = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<path d='M19.8,12A7.8,7.8 0 1 0 15.9,5.25' ${SW} stroke='${GREEN}' stroke-linecap='round'/>` +
  `<path d='M13.7,2.8L14.9,4.7L12.7,4.6' ${SW} stroke='${GREEN}' stroke-linecap='round' stroke-linejoin='round'/>` +
  `<path d='M12,16.2c-2.3,-1.7 -4.2,-3.4 -4.7,-5 -0.5,-1.5 0.4,-2.9 1.8,-3.2 1,-0.2 2,0.3 2.9,1.4 0.9,-1.1 1.9,-1.6 2.9,-1.4 1.4,0.3 2.3,1.7 1.8,3.2 -0.5,1.6 -2.4,3.3 -4.7,5z' ${SW} stroke='${RED}' stroke-linejoin='round' transform='translate(12,12.2) scale(0.70) translate(-12,-12.2)'/></svg>`;
const revNew = uri('review', true);
const keys = ['clock', 'cal', 'review', 'set'];
let cells = '';
for (const k of keys) for (const on of [false, true]) {
  cells += `<div class="cell"><div class="ico" style="background-image:url('data:image/svg+xml,${enc2(uri(k, on))}')"></div><span>${{clock:'今日',cal:'周计划',review:'复习',set:'设置'}[k]}${on ? '·选中' : ''}</span></div>`;
}
// 模拟 tabBar：复习选中
const tabIcons = keys.map(k => `<div class="tab ${k === 'review' ? 'tab-on' : ''}"><div class="tico" style="background-image:url('data:image/svg+xml,${enc2(uri(k, k === 'review'))}')"></div><span>${{clock:'今日',cal:'周计划',review:'复习',set:'设置'}[k]}</span></div>`).join('');
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0}
body{background:#F4F7F6;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:0;color:#24332F}
#page{max-width:375px;margin:0 auto;padding:18px 16px 40px}
h1{font-size:19px;margin-bottom:6px}
.sub{font-size:12.5px;color:#7C8A84;margin-bottom:16px;line-height:1.6}
.card{background:#fff;border-radius:16px;padding:16px;margin-bottom:14px;box-shadow:0 2px 10px rgba(23,107,91,.07)}
.card h2{font-size:14px;margin-bottom:4px}
.note{font-size:12px;color:#7C8A84;line-height:1.7;margin-bottom:12px}
.row{display:flex;gap:10px;align-items:stretch}
.frame{flex:1 1 0;min-width:0;border:1px solid #E4EDE9;border-radius:12px;padding:12px 8px;text-align:center}
.frame.bad{border-color:#F2C9BF;background:#FFFBFA}
.frame.good{border-color:#BFE0D5;background:#F7FCFA}
.tag{display:inline-block;font-size:11px;padding:2px 10px;border-radius:20px;margin-bottom:10px}
.tag.b{background:#FDECEA;color:#C0392B}
.tag.g{background:#E1F5EE;color:#176B5B}
.big{width:82px;height:82px;background-size:contain;background-repeat:no-repeat;background-position:center;margin:0 auto}
.cap{font-size:11.5px;color:#7C8A84;margin-top:8px;line-height:1.6}
.grid{display:flex;gap:10px;flex-wrap:wrap}
.cell{width:calc(25% - 8px);text-align:center}
.ico{width:44px;height:44px;background-size:contain;background-repeat:no-repeat;background-position:center;margin:0 auto 4px}
.cell span{font-size:11px;color:#7C8A84}
.tabbar{display:flex;background:#fff;border:1px solid #E4EDE9;border-radius:14px;padding:8px 0 6px}
.tab{flex:1;text-align:center;color:#8B9893}
.tab.tab-on{color:#176B5B}
.tico{width:26px;height:26px;background-size:contain;background-repeat:no-repeat;background-position:center;margin:0 auto 2px}
.tab span{font-size:10.5px}
</style></head><body><div id="page">
<h1>复习图标 · 修复确认</h1>
<div class="sub">上一版的弧线 sweep 标志写反：圆心 (12,12) 上该走法只存在 60° 小弧，SVG 自动换圆心 (23.7,5.2) 把大弧画成了碎块，箭头也有一臂伸出圆外 → 你在截图里看到的「碎弧+漂浮勾」。已修正并经真实浏览器截图自检（46px 与 96px 双尺寸验证通过）。</div>

<div class="card"><h2>对比</h2>
<div class="row">
<div class="frame bad"><span class="tag b">上一版 · 渲染破碎</span><div class="big" style="background-image:url('data:image/svg+xml,${enc2(oldBroken)}')"></div><div class="cap">碎弧 + 漂浮勾<br>（= 你截图看到的）</div></div>
<div class="frame good"><span class="tag g">修复版 · 已落盘</span><div class="big" style="background-image:url('data:image/svg+xml,${enc2(revNew)}')"></div><div class="cap">300° 完整弧 + 末端箭头<br>缺口右上 60°，箭头-心间距 ≈3 格</div></div>
</div></div>

<div class="card"><h2>四枚图标 · 两态全览（44px 实际比例）</h2>
<div class="note">未选中全灰 / 选中绿+红点缀镂空，其余三枚未改动。</div>
<div class="grid">${cells}</div></div>

<div class="card"><h2>tabBar 实际效果模拟（复习选中）</h2>
<div class="tabbar">${tabIcons}</div></div>
</div></body></html>`;
fs.writeFileSync(path.join(__dirname, 'tabicon-fixed-preview.html'), html);
console.log('OK tools/tabicon-fixed-preview.html');
