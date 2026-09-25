// 生成 custom-tab-bar 四枚 tab 图标（灰/绿两态）的 data-URI SVG，注入 index.wxss 标记区。
// 改图标形状/颜色只改本文件再 node tools/gen-tabicons.js，勿手改 wxss 里的编码串。
const fs = require('fs');
const path = require('path');

const GREY = '#8B9893', GREEN = '#176B5B', RED = '#D85A30';
const SW = "stroke-width='1.8' fill='none'";

// 爱心中心约 (12,12.2)，缩放 0.70；外圈=单弧300°(缺口右上60°)+末端箭头V(3点钟位,朝上)，箭头-心最小间距 ≈3 格
const HEART_T = "transform='translate(12,12.2) scale(0.70) translate(-12,-12.2)'";

function svg(parts) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${parts}</svg>`;
}
function enc(s) {
  return s.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20');
}

const icons = {
  clock: (main, red) => svg(
    `<circle cx='12' cy='13' r='8' ${SW} stroke='${main}'/>` +
    `<path d='M12,13V8.5M12,13l3,2' ${SW} stroke='${main}' stroke-linecap='round'/>` +
    (red ? `<path d='M12,13V9' ${SW} stroke='${RED}' stroke-linecap='round'/>` : '') +
    `<path d='M9,3h6' ${SW} stroke='${main}' stroke-linecap='round'/>`
  ),
  cal: (main, red) => svg(
    `<rect x='4' y='5.5' width='16' height='15' rx='2.5' ${SW} stroke='${main}'/>` +
    `<path d='M8,3.5v4M16,3.5v4' ${SW} stroke='${main}' stroke-linecap='round'/>` +
    (red ? `<path d='M9,12.5l2,2 4,-4' ${SW} stroke='${RED}' stroke-linecap='round' stroke-linejoin='round'/>`
         : `<path d='M9,12.5l2,2 4,-4' ${SW} stroke='${main}' stroke-linecap='round' stroke-linejoin='round'/>`)
  ),
  // 复习：单弧 300°（缺口在右上 60°），箭头V在弧末端(19.8,12)指向行进方向(上)，即逆时针↺「再来一遍」。
  // 注意 sweep/large-arc 标志：圆心(12,12)时 3点→1点 逆时针仅存在 60° 小弧，300° 大弧必须 sweep=1
  // （或如现在这样：从1点起 sweep=0 逆时针绕到3点）。之前 sweep=0 从3点起画导致 SVG 换候选圆心(23.7,5.2)，弧变碎块。
  review: (main, red) => svg(
    `<path d='M15.9,5.25A7.8,7.8 0 1 0 19.8,12' ${SW} stroke='${main}' stroke-linecap='round'/>` +
    `<path d='M18.4,14L19.8,12L21.2,14' ${SW} stroke='${main}' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='M12,16.2c-2.3,-1.7 -4.2,-3.4 -4.7,-5 -0.5,-1.5 0.4,-2.9 1.8,-3.2 1,-0.2 2,0.3 2.9,1.4 0.9,-1.1 1.9,-1.6 2.9,-1.4 1.4,0.3 2.3,1.7 1.8,3.2 -0.5,1.6 -2.4,3.3 -4.7,5z' ${SW} stroke='${red ? RED : main}' stroke-linejoin='round' ${HEART_T}/>`
  ),
  set: (main, red) => svg(
    `<path d='M5,8h2.6M12.4,8H19M5,16h7.6M17.4,16H19' ${SW} stroke='${main}' stroke-linecap='round'/>` +
    `<circle cx='10' cy='8' r='2.4' ${SW} stroke='${main}'/>` +
    `<circle cx='15' cy='16' r='2.4' ${SW} stroke='${red ? RED : main}'/>`
  )
};

let css = '\n/* ==== tabicons:auto-start（由 tools/gen-tabicons.js 生成，勿手改） ==== */\n';
// 深色模式变体：灰→亮灰、绿→亮绿、红点缀→亮红（在编码串上直接换色，形状不动）
const darken = s => s.replace(/%238B9893/g, '%238FA39C').replace(/%23176B5B/g, '%237CD6B4').replace(/%23D85A30/g, '%23E8795F');
for (const [key, fn] of Object.entries(icons)) {
  css += `.i-${key}{background-image:url("data:image/svg+xml,${enc(fn(GREY, false))}")}\n`;
  css += `.i-${key}.on{background-image:url("data:image/svg+xml,${enc(fn(GREEN, true))}")}\n`;
  css += `.tabbar-dark .i-${key}{background-image:url("data:image/svg+xml,${darken(enc(fn(GREY, false)))}")}\n`;
  css += `.tabbar-dark .i-${key}.on{background-image:url("data:image/svg+xml,${darken(enc(fn(GREEN, true)))}")}\n`;
}
css += '/* ==== tabicons:auto-end ==== */\n';

const wxssPath = path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.wxss');
let text = fs.readFileSync(wxssPath, 'utf8');
const START = '/* ==== tabicons:auto-start', END = '/* ==== tabicons:auto-end ==== */';
const si = text.indexOf(START), ei = text.indexOf(END);
if (si >= 0 && ei >= 0) {
  text = text.slice(0, si) + css.trim() + '\n' + text.slice(ei + END.length);
} else {
  text = text.trimEnd() + '\n' + css;
}
fs.writeFileSync(wxssPath, text);
console.log('OK 已写入', wxssPath, '（8 个图标变体）');
