// 图标-文字垂直对齐测量页生成器
// 原理：DOM 里取图标盒中心；文字墨水中心 = 基线 - (actualBoundingBoxAscent - actualBoundingBoxDescent)/2，
// 基线 = 文本 span 盒顶 + fontBoundingBoxAscent。delta = 图标中心 - 墨水中心（正=图标偏低，负=偏上）。
// 手机端尺寸按 rpx/2 换算成 px。
const fs = require('fs');
const path = require('path');

const contexts = [
  { id: 'btn27', label: '按钮27rpx(取消打卡)', font: 13.5, weight: 400, text: '取消打卡', icon: 15, valign: -2.5, iconCls: 'ico-undo' },
  { id: 'btn30', label: '按钮30rpx(立即同步)', font: 15, weight: 400, text: '立即同步', icon: 15, valign: -2.5, iconCls: 'ico-sync' },
  { id: 'done28', label: '已完成28rpx', font: 14, weight: 700, text: '今日已完成', icon: 15, valign: -2.5, iconCls: 'ico-check' },
  { id: 'dot22', label: '分组点22rpx', font: 11, weight: 400, text: '主题词 · 3', icon: 5, valign: 1, iconCls: 'dot' },
  { id: 'pbold30', label: '主按钮30rpx粗(完成打卡)', font: 15, weight: 700, text: '完成打卡', icon: 15, valign: -2.5, iconCls: 'ico-check' },
  { id: 'sbold27', label: '激活态27rpx粗(停止朗读)', font: 13.5, weight: 700, text: '停止朗读', icon: 15, valign: -2.5, iconCls: 'ico-stop' },
  { id: 'word-en', label: '词条喇叭(行1)', font: 16, weight: 700, text: 'abandon', icon: 0, flexBox: 28, flexIco: 16.7, flexMarginTop: 2, iconCls: 'spk', note: 'word-speak 28px盒 flex-center, spk=.88em*19px' },
  { id: 'example', label: '例句喇叭', font: 12.5, weight: 400, text: 'He gave up smoking.', icon: 0, flexBox: 23, flexIco: 13.2, flexMarginTop: 3, iconCls: 'spk' },
  { id: 'grammar', label: '语法行喇叭', font: 13.5, weight: 400, text: 'She has lived here for ten years.', icon: 0, flexBox: 23, flexIco: 13.2, flexMarginTop: 3.5, iconCls: 'spk', exno: true },
  { id: 'star', label: '收藏星(行1)', font: 16, weight: 700, text: 'abandon', icon: 0, flexBox: 32, flexIco: 19, flexIcoH: 18, flexMarginTop: 1.5, iconCls: 'star' }
];

const rows = contexts.map(c => {
  if (c.icon) {
    return `<div class="row" data-id="${c.id}"><span class="ico ${c.iconCls}" style="width:${c.icon}px;height:${c.icon}px;vertical-align:${c.valign}px"></span><span class="t" style="font-size:${c.font}px;font-weight:${c.weight}">${c.text}</span></div>`;
  }
  const icoH = c.flexIcoH || c.flexIco;
  const icoStyle = c.iconCls === 'star'
    ? `width:${c.flexIco}px;height:${icoH}px`
    : `width:${c.flexIco}px;height:${c.flexIco}px`;
  return `<div class="row flexrow" data-id="${c.id}" style="align-items:flex-start">
    <span class="t" style="font-size:${c.font}px;font-weight:${c.weight};line-height:1.6;flex:1">${c.exno ? '' : ''}${c.text}</span>
    <span class="flexico ${c.iconCls}" style="${icoStyle};margin-top:${c.flexMarginTop || 0}px"></span></div>`;
});

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#fff;margin:16px;color:#222}
.row{position:relative;padding:6px 10px;border:1px solid #eee;margin:2px 0;max-width:420px}
.flexrow{display:flex}
.ico{display:inline-block;background:center/contain no-repeat;margin-right:5px}
.ico-undo{background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23C0392B'%20stroke-width='1.8'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M9%2014%204%209l5-5'/%3E%3Cpath%20d='M4%209h9.5a6%206%200%200%201%200%2012H10'/%3E%3C/svg%3E")}
.ico-sync{background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23176B5B'%20stroke-width='1.8'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M20%2012a8%208%200%201%201-2.4-5.7'/%3E%3Cpath%20d='M18%203v4h-4'/%3E%3C/svg%3E")}
.ico-check{background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M4.5%2012.8l5%205L19.5%207'%20fill='none'%20stroke='%23176B5B'%20stroke-width='2.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E")}
.dot{border-radius:50%;background:#1d9e75}
.flexico{display:block;background:center/contain no-repeat;flex-shrink:0;margin-left:8px}
.spk{background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M3%209v6h4l5%205V4L7%209H3z%20M16.5%2012c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73%202.5-2.25%202.5-4.02z'%20fill='%23176B5B'/%3E%3C/svg%3E")}
.star{background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M12%2020.1C7.7%2016.9%204%2013.7%203%2010.7%202.1%207.8%203.8%205.1%206.6%204.6%208.5%204.3%2010.5%205.2%2012%206.9%2013.5%205.2%2015.5%204.3%2017.4%204.6%2020.2%205.1%2021.9%207.8%2021%2010.7%2020%2013.7%2016.3%2016.9%2012%2020.1Z'%20fill='none'%20stroke='%23FF8A78'%20stroke-width='1.8'/%3E%3C/svg%3E")}
.line{position:absolute;left:0;right:0;height:0;pointer-events:none}
.ink{border-top:2px solid rgba(220,40,40,.85)}
.ico_c{border-top:2px solid rgba(40,90,220,.85)}
.out{font:12px monospace;background:#f6f8f7;padding:10px;margin-top:12px;max-width:460px;white-space:pre-wrap}
</style></head><body>
<h3>图标-文字对齐测量（rpx/2 手机尺度）</h3>
${rows.join('\n')}
<div class="out" id="out">measuring...</div>
<script>
const ctx = [
 ${contexts.map(c => JSON.stringify({ id: c.id, label: c.label, font: c.font, weight: c.weight, text: c.text, hasIconBox: !!c.icon, flexBox: c.flexBox || 0, flexMarginTop: c.flexMarginTop || 0, exno: !!c.exno })).join(',\n ')}
];
const out = [];
for (const c of ctx) {
  const row = document.querySelector('.row[data-id="' + c.id + '"]');
  const span = row.querySelector('.t');
  const r = span.getBoundingClientRect();
  const m = document.createElement('canvas').getContext('2d');
  m.font = c.weight + ' ' + c.font + "px 'Microsoft YaHei'";
  const tm = m.measureText(c.text);
  const baseline = r.top + tm.fontBoundingBoxAscent;
  const inkCenter = baseline - (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2;
  // 画墨水中心参考线（红）
  const l1 = document.createElement('div'); l1.className = 'line ink'; l1.style.top = (inkCenter - row.getBoundingClientRect().top) + 'px'; row.appendChild(l1);
  let iconCenter, delta, extra = '';
  if (c.hasIconBox) {
    const ic = row.querySelector('.ico').getBoundingClientRect();
    iconCenter = ic.top + ic.height / 2;
    delta = iconCenter - inkCenter;
    extra = ' icoBox=' + ic.top.toFixed(1) + '+' + ic.height.toFixed(1);
  } else {
    const ic = row.querySelector('.flexico').getBoundingClientRect();
    iconCenter = ic.top + ic.height / 2;
    delta = iconCenter - inkCenter;
    extra = ' flexBox=' + c.flexBox + ' mt=' + c.flexMarginTop;
  }
  // 画图标中心参考线（蓝）
  const rr = row.getBoundingClientRect();
  const l2 = document.createElement('div'); l2.className = 'line ico_c'; l2.style.top = (iconCenter - rr.top) + 'px'; row.appendChild(l2);
  out.push(c.id.padEnd(9) + c.label.padEnd(18) + ' delta=' + delta.toFixed(2) + 'px' + (delta > 0 ? ' (图标偏低)' : ' (图标偏上)') + extra);
}
document.getElementById('out').textContent = out.join('\\n') + '\\n\\n基准: Microsoft YaHei（Windows 无 PingFang，设备端字体略有差异）';
</script>
</body></html>`;

const outPath = path.join(__dirname, 'icon-align-check.html');
fs.writeFileSync(outPath, html);
console.log('written', outPath);
