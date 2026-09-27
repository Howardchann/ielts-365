// 自检：从 custom-tab-bar/index.wxss 抽取实际落盘的图标 data-URI，生成预览页供无头浏览器截图。
const fs = require('fs');
const path = require('path');
const wxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.wxss'), 'utf8');
function uri(key, on) {
  const m = wxss.match(new RegExp(`\\.i-${key}${on ? '\\.on' : '(?![-.\\w])'}\\{background-image:url\\("data:image/svg\\+xml,([^"]+)"\\)\\}`));
  if (!m) throw new Error('not found: ' + key + (on ? '.on' : ''));
  return decodeURIComponent(m[1]);
}
const keys = ['clock', 'cal', 'review', 'set'];
// encodeURIComponent 不转义单引号，会截断外层 url('...')，需补 %27
const enc2 = s => encodeURIComponent(s).replace(/'/g, '%27');
let cells = '';
for (const k of keys) {
  for (const on of [false, true]) {
    cells += `<div class="cell"><div class="ico" style="background-image:url('data:image/svg+xml,${enc2(uri(k, on))}')"></div><span>${k}${on ? '·on' : ''}</span></div>`;
  }
}
const rev = uri('review', true);
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{background:#fff;font-family:monospace;margin:20px}
.grid{display:flex;gap:14px;flex-wrap:wrap}
.cell{width:90px;text-align:center;font-size:12px;color:#333}
.ico{width:46px;height:46px;background-size:contain;background-repeat:no-repeat;background-position:center;margin:0 auto}
.big{width:96px;height:96px;background-size:contain;background-repeat:no-repeat;background-position:center;margin-top:16px}
</style></head><body>
<h3>落盘 wxss 实测（46px 实际尺寸）</h3><div class="grid">${cells}</div>
<h3>review 选中态 96px 放大</h3>
<div class="big" style="background-image:url('data:image/svg+xml,${enc2(rev)}')"></div>
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'tabicon-check.html'), html);
console.log('OK tools/tabicon-check.html');
