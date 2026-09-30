# 快听 · Mac 本地应用

薄荷风的桌面音频工作台，使用 Electron 加载项目内的 HTML、CSS 和 JavaScript。无需启动网页服务，页面、字体和提示音均可离线使用。

**支持淘宝、小红书与抖音直播，可收听真实直播的纯音频（FLV 只解码音轨）。**

- 淘宝：网页版直播间链接（带 liveId 的 /live、/follow），匿名 H5 会话解析。2026-09-28 实测约 1 秒起播。
- 小红书：App 分享短链（xhslink.com）或网页版直播间地址，页面数据匿名可解析，取 pullConfig 的 FLV（主/备）。2026-09-29 实测约 2 秒起播、缓冲约 0.5 秒。
- 抖音：网页版地址（live.douyin.com/<房间号>）或 App 分享短链（v.douyin.com），匿名拿 ttwid 后调 webcast enter 接口（需完整浏览器参数，否则返回空体软封锁），取最低档 FLV（SD2→SD1→HD1）。2026-09-30 实测约 2 秒起播、缓冲 0.5 秒。

三个平台共用同一播放管线：mpegts 纯音频 + 1.2 秒追帧 + 自动重连，主进程按平台分发解析并代理流（白名单覆盖 alicdn/tbcache、xhscdn 与 douyincdn）。

**自动重连（自 v0.3 移植）**：网络或推流故障最多自动重试 3 次（间隔 0.5、1.5、3 秒），每次重新获取播放地址；断网时挂起等待、联网后自动恢复；连续稳定播放 30 秒后恢复重试额度。下播、无音轨、格式不支持、需要登录/验证的直播间不会反复请求。停止、暂停、切换直播间会取消旧请求与重试。

关于延迟：已实测淘宝接口没有纯音频流地址，也没有可用的公开低延时通道——接口返回的 `artc://` RTC 地址走的是淘宝私有信令协议，公开 `aliyun-rts-sdk` 无法对接（信令 404，2026-09-28 实测）。应用内保留了完整的 ARTC 播放与自动退回逻辑（`KUAITING_ARTC=1` 启用），未来协议可对接时无需改动渲染层。相对手机观看的提前量需要实测。

## 在 VS Code 中试用

1. 打开本目录中的 `kuaiting.code-workspace`，或在 VS Code 中打开整个 `快听` 文件夹。
2. 依赖已经安装；重新下载项目时，在终端执行 `npm ci`（Node.js 22.12 或以上）。
3. 按 **F5**，选择 **快听：启动 Mac 应用**。Mac 默认功能键设置下可能需要 **Fn + F5**。
4. 也可以打开 VS Code 终端，执行 `npm run dev`。

开发模式会在 `dist/` 文件变化后自动刷新应用。修改 `electron/` 下的主进程或预加载文件后需要重启。停止调试后再启动，以免已有进程占用单实例锁。

## 双击打开

本机打包输出位于：`release/快听-darwin-arm64/快听.app`。

这是适用于当前 Apple 芯片 Mac 的本地应用，已做本机 ad-hoc 签名，未进行 Apple 开发者证书签名及公证。可直接在当前机器试用，向其他电脑分发前需要正式签名和公证。

重新打包：

```sh
npm run package:mac
```

命令会为当前 Mac 架构生成 `.app`；在 Intel Mac 上运行时输出目录为 `release/快听-darwin-x64/`。无需安装到「应用程序」目录即可运行。

如果下载 Electron 运行时失败（无法访问 GitHub），可改用镜像：`ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm run package:mac`。

## 可体验的功能

- 粘贴及校验淘宝网页版直播间地址。
- **收听真实直播**：解析直播间详情，经主进程代理拉取 FLV 流，只解码音频播放。
- 收藏、命名和删除直播间，数据保存在这台 Mac 的应用数据目录中。
- 本地提示音试听、暂停、停止、音量、静音及倍速（直播与提示音共用这些控制）。
- 原生 Mac 菜单和快捷键：⌘V 粘贴、⌘Q 退出、⌘R 刷新。
- 播放偏好、减少动画、帮助说明。

直播连接使用淘宝匿名 H5 会话，不需要登录淘宝账号；淘宝要求登录或验证时会如实报错。开发版和打包版使用同一应用数据目录，网页收藏不会自动导入。

## 项目结构

```text
dist/                     页面源码（直接编辑，无需编译）
dist/live-player.js       渲染进程 FLV 直播播放器（mpegts.js 纯音频）
dist/vendor/              mpegts.js 及其许可证
electron/main.cjs         Mac 窗口、菜单、生命周期、直播流代理协议
electron/taobao-live.cjs  淘宝直播详情解析（匿名 H5 会话）与 CDN 流校验
electron/preload.cjs      隔离的桌面 API
assets/                   Mac 应用图标
scripts/package-mac.cjs   本机打包与签名
tests/                    直播解析与流校验的单元测试
.vscode/                  F5 调试、运行和打包任务
release/                  生成的 Mac 应用（不提交 Git）
```

网页保持独立可用；本次只包装本地应用，没有重新发布线上版本。

## 检查与技术说明

```sh
npm run check
npm run test:smoke
```

启动检查使用临时应用数据目录，检查本地页面加载、隔离预加载脚本与页面初始化，并捕获加载失败、渲染进程退出及控制台错误。它不会读取或覆盖你的收藏。

渲染进程启用 `contextIsolation` 和沙箱，禁用 Node 集成。剪贴板仅通过受限 IPC 方法、由粘贴按钮调用，主进程校验请求来源。渲染进程不能直接访问网络：页面内容安全策略只放行本地的 `kuaiting-stream:` 媒体来源，淘宝接口与 CDN 流的请求全部由主进程代为完成，并限制在 `h5api.m.taobao.com`、`alicdn.com`、`tbcache.com` 等白名单域名内。

图标由 `scripts/create-icon.swift` 绘制；重新生成 PNG 可使用 `swiftc -framework AppKit scripts/create-icon.swift -o /tmp/kuaiting-create-icon`，再执行 `/tmp/kuaiting-create-icon assets/icon.png`。PNG 和 ICNS 已提交，日常启动及打包不需要 Swift。

可选 WebMCP `stage_taobao_live_link` 仅校验并填入链接，不播放。没有支持该 API 的验证上下文，未验证注册与调用。

桌面安全配置参考 [Electron 官方文档](https://www.electronjs.org/docs/latest/tutorial/security)。
