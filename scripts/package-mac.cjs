'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'darwin') throw new Error('请在 macOS 上运行此打包命令。');
  const { packager } = await import('@electron/packager');
  const project = path.resolve(__dirname, '..');
  const paths = await packager({
    dir: project, name: '快听', executableName: 'Kuaiting',
    platform: 'darwin', arch: process.arch, out: path.join(project, 'release'),
    overwrite: true, asar: true, prune: true,
    appBundleId: 'com.kuaiting.desktop', appCategoryType: 'public.app-category.entertainment',
    icon: path.join(project, 'assets', 'icon.icns'),
    ignore: [ /^\/release($|\/)/, /^\/\.git($|\/)/, /^\/\.openai($|\/)/,
      /^\/\.vscode($|\/)/, /^\/scripts($|\/)/, /^\/README\.md$/, /^\/kuaiting\.code-workspace$/ ],
    extendInfo: { NSHumanReadableCopyright: '快听 · 让声音先一步',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } }
  });
  for (const directory of paths) {
    const application = path.join(directory, '快听.app');
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
    console.log(`\n已打包并验证本机签名：${application}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
