'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist', 'vendor');
fs.mkdirSync(target, { recursive: true });
for (const file of ['mpegts.js', 'mpegts.js.LICENSE.txt']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'mpegts.js', 'dist', file), path.join(target, file));
}
fs.copyFileSync(path.join(root, 'node_modules', 'mpegts.js', 'LICENSE'), path.join(target, 'mpegts.LICENSE'));
// aliyun-rts-sdk（MIT）为 UMD 单文件，无 worker / wasm 依赖。
fs.copyFileSync(path.join(root, 'node_modules', 'aliyun-rts-sdk', 'dist', 'aliyun-rts-sdk.js'), path.join(target, 'aliyun-rts-sdk.js'));
fs.writeFileSync(path.join(target, 'aliyun-rts-sdk.LICENSE'), 'aliyun-rts-sdk v2.15.0 — MIT License\n来源：npm 包 aliyun-rts-sdk（经 npmmirror 镜像安装），许可声明见包内 package.json。\n');
