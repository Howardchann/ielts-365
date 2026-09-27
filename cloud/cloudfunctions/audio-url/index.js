// audio-url —— 批量签发云存储临时访问链接
//
// 为什么需要它：云开发环境处于免费期时，「存储权限」被锁定为
// 「仅创建者和管理员可读写」，客户端 wx.cloud.downloadFile /
// getTempFileURL 全部会被拒（安全规则按 resource.openid 判定，
// 而文件是用管理端 CLI 上传的，不属于任何用户）。
// 云函数以管理端身份运行，拥有全部读写权限，因此可以签出临时链接。
//
// 调用：wx.cloud.callFunction({ name: 'audio-url', data: { paths: ['w/0/0001.mp3', ...] } })
// 返回：{ ok: true, items: [{ fileID, path, url, status, errMsg }] }
// 限制：单次最多 50 条（getTempFileURL 的上限）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const FILE_PREFIX = 'cloud://cloud1-d2gfv3f254c476e40.636c-cloud1-d2gfv3f254c476e40-1493393272';
const MAX_BATCH = 50;
const MAX_AGE = 7200;                            // 显式指定 2 小时（各版本文档口径不一，写死以免踩默认值差异）
const PATH_RE = /^([ws]\/[0-8]\/\d{4}s?\.mp3|g\/[0-9]\/[0-9a-f]{8}s?\.mp3)$/;   // 只允许音频路径（w/s=词库编号，g=语法例句哈希），避免被拿来当通用签名器

exports.main = async (event) => {
  const raw = (event && event.paths) || [];
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'paths 不能为空' };

  const paths = [];
  const invalid = [];
  raw.slice(0, MAX_BATCH).forEach(p => {
    const s = String(p || '').replace(/^\/+/, '');
    if (PATH_RE.test(s)) paths.push(s); else invalid.push(s);
  });
  if (!paths.length) return { ok: false, error: '无合法路径', invalid: invalid };

  try {
    const res = await cloud.getTempFileURL({
      fileList: paths.map(p => ({ fileID: FILE_PREFIX + '/' + p, maxAge: MAX_AGE })),
    });
    const items = (res.fileList || []).map((f, i) => ({
      fileID: f.fileID,
      path: paths[i],
      url: f.tempFileURL || '',
      status: f.status,
      errMsg: f.errMsg || '',
    }));
    return { ok: true, items: items, invalid: invalid, maxAge: MAX_AGE };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
