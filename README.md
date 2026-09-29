# 快听 · Mac 本地应用

薄荷风的桌面音频工作台，使用 Electron 加载项目内的 HTML、CSS 和 JavaScript。无需启动网页服务，页面、字体和提示音均可离线使用。

**已接入淘宝直播解析，可收听真实直播的纯音频（FLV 只解码音轨）。当前版本为 0.3.0。**

## 0.3 自动小步追赶

- 每 250 ms 检查一次连续可播放缓冲，目标为 0.5 秒；超过约 0.58 秒即开始追赶，不等待严重积压、不弹确认。
- 单次前移 20–60 ms，配合 1.02–1.08× 轻微加速；用户选择更高倍速时，仅在积压期间用作追赶加速。接近目标后自动回到 1.0×，避免持续倍速耗空缓冲。
- 缓冲不足、暂停、正在定位或缓冲有断层时不前移。目标值是调度参数，不保证实际缓冲始终达标。
- **小步前移仍会跳过短片段，不能保证不漏短音节。** 可以在「使用帮助 → 本次播放诊断」查看前移次数及累计时长。
- 临时断网自动等待联网；网络或推流故障最多重试 3 次（间隔 0.5、1.5、3 秒），每次重新获取播放地址。连续稳定播放 30 秒后恢复重试额度。下播、无音轨、格式不支持、登录/验证要求不会反复请求。
- 停止、暂停、切换直播间会取消旧请求和重试。匿名令牌仅在内存复用，最久 5 分钟，并提前于令牌到期失效。
- 诊断记录解析耗时、首次播放事件耗时、本地缓冲、追赶、卡顿及重连；起播时间不包括对物理扬声器出声的测量。没有录制或上传直播音频。

相对手机观看的提前量仍需用同一句主播声音对齐录音测量；本地缓冲不等于直播总延迟。之前的起播和缓冲测量属于旧版本，不能作为本版性能承诺。

ARTC 默认关闭。之前对部分淘宝 ARTC 地址使用公开 SDK 返回 404，尚未验证兼容性，不代表所有直播间均不可用。保留 `KUAITING_ARTC=1` 实验入口；现在回退计时等待真正起播，9 秒未出播放事件则回退 FLV。

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
dist/live-player.js       播放状态、自动重连及 RTC 回退
dist/latency-controller.js 自动小步追赶控制器
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
npm test
npm run test:smoke
```

启动检查使用临时应用数据目录，检查本地页面加载、隔离预加载脚本与页面初始化，并捕获加载失败、渲染进程退出及控制台错误。它不会读取或覆盖你的收藏。

渲染进程启用 `contextIsolation` 和沙箱，禁用 Node 集成。剪贴板仅通过受限 IPC 方法、由粘贴按钮调用，主进程校验请求来源。默认 FLV 路径通过 `kuaiting-stream:` 本地协议播放，淘宝接口与 CDN 流由主进程请求并校验域名。实验 RTC 的页面策略还允许淘宝和阿里云的 HTTPS/WSS 域名。

图标由 `scripts/create-icon.swift` 绘制；重新生成 PNG 可使用 `swiftc -framework AppKit scripts/create-icon.swift -o /tmp/kuaiting-create-icon`，再执行 `/tmp/kuaiting-create-icon assets/icon.png`。PNG 和 ICNS 已提交，日常启动及打包不需要 Swift。

可选 WebMCP `stage_taobao_live_link` 仅校验并填入链接，不播放。没有支持该 API 的验证上下文，未验证注册与调用。

桌面安全配置参考 [Electron 官方文档](https://www.electronjs.org/docs/latest/tutorial/security)。
