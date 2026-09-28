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
