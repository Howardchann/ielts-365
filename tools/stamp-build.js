#!/usr/bin/env node
// tools/stamp-build.js —— 把当前构建标识写进 miniprogram/utils/build-info.js
//
// 为什么需要它：小程序运行时不认识 git，而「关于」卡片要显示"我现在跑的是哪一版"。
// 做法是在**上传 / 预览之前**跑一次本脚本，把 HEAD 的短 sha 与时间戳固化成常量模块。
//
// 用法（在仓库根目录）：
//     node tools/stamp-build.js
//
// ⚠️ 这是**手工步骤** —— 微信开发者工具没有"上传前执行命令"的官方钩子，
//    所以它必须进流程（见 tools/cloudsync-test/真机实测清单.md §1.1）。
//    真机测试前若忘记跑，界面上显示的就是上一次的 sha，会误导判断。
//
// 实现说明：**不调用 git 可执行文件** —— 直接读 .git 目录（HEAD / refs / packed-refs）。
// 好处是没有"git 不在 PATH"的坑（Windows 上很常见），换机器也能跑。
// 「工作区是否干净」这一项无法用纯文件判断，只在 git 可调用时才填，否则为 false 并提示。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'miniprogram', 'utils', 'build-info.js');
// 自指文件名：算 dirty 时要忽略它自己，否则每次生成都会把工作区标记成"已修改"
const SELF = 'miniprogram/utils/build-info.js';

function gitDir() {
  const dot = path.join(ROOT, '.git');
  let st;
  try { st = fs.statSync(dot); } catch (e) { return null; }
  if (st.isDirectory()) return dot;
  // .git 是文件（worktree / submodule）：内容形如 "gitdir: D:/x/.git/worktrees/y"
  try {
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dot, 'utf8'));
    if (m) return path.resolve(ROOT, m[1].trim());
  } catch (e) {}
  return null;
}

function readHead(dir) {
  const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  const m = /^ref:\s*(.+)$/.exec(head);
  if (!m) return { sha: head, branch: '(detached)' };   // detached HEAD：HEAD 本身就是 sha
  const ref = m[1].trim();
  const branch = ref.replace(/^refs\/heads\//, '');
  const loose = path.join(dir, ref);
  if (fs.existsSync(loose)) return { sha: fs.readFileSync(loose, 'utf8').trim(), branch };
  // 已被 pack 进 packed-refs
  const packed = path.join(dir, 'packed-refs');
  if (fs.existsSync(packed)) {
    for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
      if (!line || line[0] === '#' || line[0] === '^') continue;
      const sp = line.indexOf(' ');
      if (sp > 0 && line.slice(sp + 1).trim() === ref) return { sha: line.slice(0, sp).trim(), branch };
    }
  }
  return { sha: '', branch };
}

function tryDirty() {
  try {
    const cp = require('child_process');
    for (const bin of [process.env.GIT_BIN, 'git', 'git.exe'].filter(Boolean)) {
      const r = cp.spawnSync(bin, ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
      if (r && r.status === 0 && typeof r.stdout === 'string') {
        return { dirty: r.stdout.split('\n').filter(l => l.trim() && !l.includes(SELF)).length > 0, known: true };
      }
    }
  } catch (e) {}
  return { dirty: false, known: false };
}

const dir = gitDir();
const { sha: fullSha, branch } = dir ? readHead(dir) : { sha: '', branch: '' };
const sha = fullSha ? fullSha.slice(0, 7) : '';
const { dirty, known } = tryDirty();
const builtAt = Date.now();

const body =
  '// 本文件由 tools/stamp-build.js 自动生成 —— 请勿手工编辑。\n' +
  '// 在开发者工具点「上传」或「预览」之前跑一次：node tools/stamp-build.js\n' +
  '// 作用：让「设置 → 关于」显示手机上跑的到底是哪一次提交。\n' +
  "module.exports = {\n" +
  `  sha: '${sha}',\n` +
  `  branch: '${branch}',\n` +
  `  dirty: ${dirty},\n` +
  `  builtAt: ${builtAt},\n` +
  '};\n';

fs.writeFileSync(OUT, body, 'utf8');

const d = new Date(builtAt), p = n => String(n).padStart(2, '0');
console.log('✅ 已写入 ' + SELF);
console.log(`   sha=${sha || '(未取到)'}  branch=${branch || '(未知)'}  dirty=${dirty}  builtAt=${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
if (!sha) console.log('   ⚠️ 读不到 .git（未初始化 / 不是仓库）→ 界面只显示版本号与时间');
if (!known) console.log('   ⚠️ 无法调用 git，跳过"工作区是否干净"判定（dirty 按 false 处理）');
if (dirty) console.log('   ⚠️ 工作区有未提交改动 → 界面上 sha 后会带 * 号（属正常，代表"这一版不是干净的提交"）');
