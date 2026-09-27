// utils/cloud.js —— 云开发配置
//
// 语音链路：本地缓存 →【云函数签名 → 云存储音频】→ 在线 TTS 兜底
//
// ⚠️ 为什么不直接用 wx.cloud.downloadFile：
//   本环境处于「免费期」，云存储权限被锁定为「仅创建者和管理员可读写」，
//   而音频是用管理端 CLI 批量上传的（不属于任何用户），安全规则按
//   resource.openid 判定 → 客户端 downloadFile / getTempFileURL 一律被拒。
//   免费期无法修改权限（控制台与后台 API 双双拦截：
//   ModifyStorageSafeRule — 当前套餐无法执行此操作）。
//   → 改由云函数（管理端身份，拥有全部读写权限）批量签发临时链接，客户端播放该链接。
//
// ENV          云开发环境 ID（「微信开发者工具 → 云开发 → 设置 → 环境ID」查看）
// FILE_PREFIX  云存储文件 ID 前缀，形如 cloud://<环境ID>.<存储桶标识>
//              客户端不再直接使用；云函数 audio-url 内部用它拼 fileID
// SIGN_FN      签发临时链接的云函数名（代码见 cloudfunctions/audio-url）
const ENV = 'cloud1-d2gfv3f254c476e40';
const FILE_PREFIX = 'cloud://cloud1-d2gfv3f254c476e40.636c-cloud1-d2gfv3f254c476e40-1493393272';
const SIGN_FN = 'audio-url';

function ready() {
  return !!(ENV && wx.cloud && wx.cloud.callFunction);
}

module.exports = { ENV, FILE_PREFIX, SIGN_FN, ready };
