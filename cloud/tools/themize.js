// themize.js —— 把 wxss 硬编码色替换为 CSS 变量 token（夜间模式换色工程）。
// 规则：url(...) 内（SVG data-URI）一律不动；按声明属性上下文查映射表，未映射的色值原样保留。
// 用法：node tools/themize.js [--fallback] 文件1 文件2 ...
//   --fallback：生成 var(--token, 原色)（给 styleIsolation 组件用，防止变量不可达时失色）
const fs = require('fs');

const COLOR = {
  '#24332f': '--ink', '#5f6d68': '--ink2', '#53605b': '--ink3', '#43504c': '--ink4', '#4a5a56': '--ink3',
  '#8b9893': '--muted', '#82908b': '--muted2', '#66736e': '--muted3', '#7b8a84': '--muted4', '#7a8a86': '--muted4',
  '#a6b2ad': '--disabled-ink', '#c7d0cc': '--star-off', '#d5ddd9': '--dis2',
  '#176b5b': '--green', '#2e8b72': '--green-mid', '#0f4a3e': '--green-press',
  '#c0392b': '--red', '#a93226': '--red-press'
};
const BG = {
  '#fff': '--card', '#ffffff': '--card',
  '#f3f8ef': '--bg', '#f0f7f3': '--soft', '#e6f4ee': '--soft2', '#edf3f0': '--disabled-bg',
  '#dcefe7': '--press-green', '#fdecea': '--red-soft', '#f8fcf9': '--cur-bg', '#fbfdfc': '--field',
  '#176b5b': '--green-solid', '#c7d0cc': '--star-off', '#e9f0ec': '--line', '#d5ede3': '--press2'
};
const BORDER = {
  '#e9f0ec': '--line', '#eef4f1': '--line', '#e8efeb': '--line', '#e4ede9': '--line', '#f0f5f2': '--line', '#d6e4e0': '--line',
  '#9ed8c5': '--cur-line', '#176b5b': '--green', '#2e8b72': '--green-mid', '#7b8a84': '--muted4'
};

const args = process.argv.slice(2);
const fallback = args[0] === '--fallback';
const files = fallback ? args.slice(1) : args;

function varOf(token, orig) {
  return fallback ? `var(${token}, ${orig})` : `var(${token})`;
}

function mapValue(prop, value) {
  let dict = null;
  const p = prop.toLowerCase();
  if (p === 'color') dict = COLOR;
  else if (p.startsWith('background')) dict = BG;
  else if (p.startsWith('border') || p === 'outline') dict = BORDER;
  if (!dict) return value;
  // 特例：绿色系半透明分隔线整体换 token
  if (value.includes('rgba(23,107,91,.18)')) value = value.replace('rgba(23,107,91,.18)', varOf('--line', 'rgba(23,107,91,.18)'));
  return value.replace(/#[0-9a-fA-F]{3,8}\b/g, hex => {
    const token = dict[hex.toLowerCase()];
    return token ? varOf(token, hex) : hex;
  });
}

for (const f of files) {
  let text = fs.readFileSync(f, 'utf8');
  // 保护 url(...)（SVG data-URI 内的 %23xxxx 色值不参与映射）
  const urls = [];
  text = text.replace(/url\([^)]*\)/g, m => { urls.push(m); return `\u0000${urls.length - 1}\u0000`; });
  // 逐声明替换
  text = text.replace(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g, (m, prop, val) => `${prop}:${mapValue(prop, val)}`);
  text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => urls[Number(i)]);
  fs.writeFileSync(f, text);
  console.log('OK', f);
}
