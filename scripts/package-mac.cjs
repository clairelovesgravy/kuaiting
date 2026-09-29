'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'darwin') throw new Error('请在 macOS 上运行此打包命令。');
  const distribute = process.argv.includes('--distribute');
  let signing;
  let profile;
  if (distribute) {
    const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const available = [...identities.matchAll(/\b([A-Fa-f0-9]{40}) "(Developer ID Application: [^"\n]+)"/g)];
    const requested = process.env.KUAITING_SIGN_IDENTITY;
    const selected = requested
      ? available.find(match => match[1] === requested || match[2] === requested)
      : available.length === 1 ? available[0] : null;
    if (!selected) throw new Error('未找到唯一可用的 Developer ID Application 证书（含私钥）。请先导入证书；多张证书时用 KUAITING_SIGN_IDENTITY 指定完整名称或 SHA-1。');
    profile = process.env.KUAITING_NOTARY_PROFILE || 'kuaiting-notary';
    execFileSync('/usr/bin/xcrun', ['--find', 'stapler'], { stdio: 'pipe' });
    try {
      execFileSync('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json'], { stdio: 'pipe', timeout: 60000 });
    } catch {
      throw new Error('公证凭据预检未通过。请检查网络，并用 xcrun notarytool store-credentials 配置钥匙串档案：' + profile);
    }
    signing = { identity: selected[1], optionsForFile: () => ({
      hardenedRuntime: true,
      entitlements: path.join(__dirname, 'entitlements.mac.plist')
    }) };
    console.log('开发者证书及公证凭据预检通过，开始正式打包、签名并提交 Apple 公证。');
  }
  const { packager } = await import('@electron/packager');
  const project = path.resolve(__dirname, '..');
  const paths = await packager({
    dir: project, name: '快听', executableName: 'Kuaiting',
    platform: 'darwin', arch: process.arch, out: path.join(project, 'release', ...(distribute ? ['notarized'] : [])),
    ...(distribute ? { osxSign: signing, osxNotarize: { keychainProfile: profile } } : {}),
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
    if (!distribute) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
    if (distribute) {
      execFileSync('/usr/bin/xcrun', ['stapler', 'validate', application], { stdio: 'inherit' });
      execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', application], { stdio: 'inherit' });
      const archive = path.join(directory, `快听-${require('../package.json').version}-${process.arch}.zip`);
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, archive], { stdio: 'inherit' });
      console.log(`\n开发者签名、公证票据和 Gatekeeper 验证通过：${archive}`);
    } else console.log(`\n已打包并验证本机签名：${application}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
