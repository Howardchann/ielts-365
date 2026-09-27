// darkicons.js —— 为 app.wxss 里的 SVG data-URI 图标生成 .theme-dark 亮色变体。
// 深色背景下 #176B5B 描边/填充图标对比度不足，自动换亮绿/亮红版本，追加到 app.wxss 末尾 auto 块。
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'miniprogram', 'app.wxss');
let text = fs.readFileSync(file, 'utf8');

const SWAP = [
  [/%23176B5B/g, '%237CD6B4'], // 品牌绿 → 亮绿
  [/%23C0392B/g, '%23E8795F']  // 危险红 → 亮红
];
const START = '/* ==== darkicons:auto-start（由 tools/darkicons.js 生成，勿手改） ==== */';
const END = '/* ==== darkicons:auto-end ==== */';

const re = /(\.[a-z][a-z0-9-]*)\{background-image:url\("data:image\/svg\+xml,([^"]+)"\)\}/g;
let block = '\n' + START + '\n';
let m, n = 0;
const seen = new Set();
while ((m = re.exec(text)) !== null) {
  const sel = m[1];
  if (seen.has(sel)) continue;
  seen.add(sel);
  // 没有可换色的（纯白 on 态图标）跳过
  if (!/%23176B5B|%23C0392B/.test(m[2])) continue;
  let darkUri = m[2];
  for (const [reFrom, to] of SWAP) darkUri = darkUri.replace(reFrom, to);
  block += `.theme-dark ${sel}{background-image:url("data:image/svg+xml,${darkUri}")}\n`;
  n++;
}
block += END + '\n';

if (text.includes(START)) {
  const si = text.indexOf(START), ei = text.indexOf(END);
  text = text.slice(0, si) + block.trim() + '\n' + text.slice(ei + END.length);
} else {
  text = text.trimEnd() + '\n' + block;
}
fs.writeFileSync(file, text);
console.log('OK 深色图标变体', n, '个');
