(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KuaitingRoomLink = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function parse(value) {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('请粘贴完整的淘宝网页版直播间链接。');
    const text = value.trim().replace(/\\([&_])/g, '$1').replace(/&amp;/g, '&');
    let url;
    try { url = new URL(text); } catch { throw new Error('请粘贴完整的淘宝网页版直播间链接。'); }
    if (url.protocol !== 'https:' || url.hostname !== 'tbzb.taobao.com' || url.port || url.username || url.password || !/^\/(live|follow)\/?$/.test(url.pathname)) {
      throw new Error('请粘贴淘宝网页版 /live 或 /follow 直播间链接。');
    }
    const ids = url.searchParams.getAll('liveId');
    if (ids.length !== 1 || !/^\d{1,30}$/.test(ids[0])) throw new Error('链接缺少有效的 liveId，请进入具体直播间后复制完整地址。');
    return { url: url.href, liveId: ids[0] };
  }
  return { parse };
});
