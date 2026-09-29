(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KuaitingRoomLink = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ROOM_PATH = /^\/livestream\/[^/]+\/(\d{1,30})\/?$/;
  function parse(value) {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('请粘贴完整的直播间链接。');
    const text = value.trim().replace(/\\([&_])/g, '$1').replace(/&amp;/g, '&');
    let url;
    try { url = new URL(text); } catch { throw new Error('请粘贴完整的直播间链接。'); }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('请粘贴淘宝或小红书直播间链接。');
    // 小红书分享短链：roomId 藏在重定向后的地址里，由主进程解析。
    if (url.hostname === 'xhslink.com') return { url: url.href, liveId: '', platform: 'xhs' };
    if (url.hostname === 'www.xiaohongshu.com' || url.hostname === 'xiaohongshu.com') {
      const match = url.pathname.match(ROOM_PATH);
      if (!match) throw new Error('请进入小红书直播间后，复制完整的直播间地址。');
      return { url: url.href, liveId: match[1], platform: 'xhs' };
    }
    if (url.hostname !== 'tbzb.taobao.com' || !/^\/(live|follow)\/?$/.test(url.pathname)) {
      throw new Error('请粘贴淘宝网页版或小红书直播间链接。');
    }
    const ids = url.searchParams.getAll('liveId');
    if (ids.length !== 1 || !/^\d{1,30}$/.test(ids[0])) throw new Error('链接缺少有效的 liveId，请进入具体直播间后复制完整地址。');
    return { url: url.href, liveId: ids[0], platform: 'taobao' };
  }
  return { parse };
});
