# 番茄钟

Windows 桌面番茄钟。核心理念：**到点先提醒、不打断，真去休息时再把你从屏幕前拉起来**——番茄到点只在右下角挂一个小窗，点了才进全屏休息遮罩；拖着不休息的时间会算进下一次休息，超过健康上限就变红催你。

Electron + 纯 JavaScript（无前端框架、无打包器），数据全部保存在本机，不联网。界面各状态另有一份 Storybook 目录，见「开发」。

## 功能规格

### 核心循环
- 经典 25/5/15 节奏：25 分钟工作 + 5 分钟短休息，每完成 4 个番茄进入 15 分钟长休息（时长均可在设置中修改）
- 番茄到点 → 提示音 + 屏幕右下角一个不抢焦点的小窗（可拖走）说「该休息了」，**不强制**：手头的事想收个尾就接着干，点了「去休息」才进休息
- 小窗挡路时点「›」收成右下角一个小方块，仍带着健康色在余光里提醒，点一下展开回卡片（只是窗口大小，计时不受影响）
- 到点同时发一条系统通知：用了 Windows 虚拟桌面时小窗未必在眼前，通知不受桌面限制（见「已知限制」）
- 真进休息 → **全屏休息遮罩**（覆盖所有显示器，副屏只显示倒计时）
- 休息倒计时只报整分钟（「还剩 5 分钟」），不跳秒——休息时不该盯着数字看
- 休息中可「暂时让开 30 秒」：遮罩整体收起，去开个音乐、回条消息，到点自动盖回来（休息倒计时照常走，不补时长）
- 休息中可「跳过休息」直接开始下一个番茄（按钮弱化，不鼓励）
- 休息结束后遮罩停留，显示「开始下一个番茄」，回到座位手动点击才继续计时——人不在时计时不空跑
- 工作中可暂停/继续，也可放弃当前番茄（放弃不计入完成数）
- 「结束专注」任何时候可用，退出循环回到空闲；连续工作过久时也会自动触发（见下）

### 拖堂与健康提醒
- 不强制休息，但欠的会补回来：番茄到点后拖着不休息的时间照样算工作，按设置里的「工作:休息」比例折算，加进这次休息的时长（最多补到 2 倍）——多干 10 分钟，25/5 的节奏就多休 2 分钟
- 连续工作时长超过「健康上限」（默认 50 分钟，可在设置中修改），右下角小窗和主窗口的状态标签变红催促；接近上限时先变琥珀色
- 连续工作超过「自动结束专注」阈值（默认 120 分钟，0 = 关闭）→ 自动收摊回到空闲并发系统通知，右下角小窗不会挂到天亮。工作中同样生效：番茄进行到一半也会被截断并记为放弃，所以别把它设得比番茄时长还短
- 刚跨过健康上限时补一条系统通知催一次（每个番茄只发一次，不做周期轰炸）
- 暂停的时间不算进连续工作时长，中途开个会不会被误判为拖堂，挂着暂停也不会被自动收摊
- 番茄的历史记录仍以「到点那一刻」为准：拖堂时间只用来调休息时长和变色，不会把一次番茄撑成三小时

### 复盘与历史
- 休息遮罩上有一句话速记框：随手记下这个番茄做了什么（可跳过），自动挂到刚完成的番茄上
- 主窗口「历史」页按天翻看：每个番茄的起止时间、速记内容、完成/放弃状态、每日完成数与专注时长
- 数据以 JSON 存储在本地用户目录，不上传任何数据

### 跨虚拟桌面
- 用了 Windows 虚拟桌面（Win+Ctrl+D）时，切到别的桌面后「该休息了」小窗和休息遮罩会自动跟过来，不会被落在原来的桌面上
- 走的是公开的 `IVirtualDesktopManager`（微软对它的定位就是「让辅助窗口跟着人跑」），没有碰未公开接口，不会因 Windows 更新而失效
- 系统通知本来就不受桌面限制，跟随万一不可用时它仍能把提醒送到

### 系统集成
- 关闭主窗口 = 退到托盘继续计时；托盘菜单含开始/暂停/放弃/结束专注/退出
- 开机自启（启动到托盘，不弹主窗口），可在设置中关闭
- 单实例：重复启动只会唤出已运行实例的主窗口
- 系统休眠唤醒后自动校正计时（按真实挂钟时间）
- 自动更新：启动后静默检查 GitHub Releases 并后台下载，不打断计时；下载就绪后在设置页/托盘出现「重启并更新」，用户退出应用时也会自动装上

### 外观
- 中文界面，主题跟随系统深浅色（可手动固定深色/浅色）
- 休息遮罩始终为深色柔和配色，夜间弹出不刺眼

## 目录结构

```
src/main/timer-core.js   计时状态机（纯逻辑，可单测）
src/main/main.js         Electron 主进程：窗口/托盘/遮罩/IPC/自启
src/main/store.js        settings/history/runtime 的本地 JSON 持久化
src/main/virtual-desktop.js  Windows 虚拟桌面跟随（koffi 调 IVirtualDesktopManager）
src/main/preload.js      contextBridge 安全桥
src/renderer/main.*      主窗口（计时/历史/设置三个页签）
src/renderer/overlay.*   全屏休息遮罩
src/renderer/due.*       「该休息了」的右下角小窗
src/renderer/views/*     三个窗口的纯视图层（只吃 (root, 数据)，应用与 Storybook 共用）
src/renderer/sound.js    WebAudio 合成提示音（无音频素材）
scripts/generate-icons.js 程序化生成番茄图标（零依赖 PNG/ICO 编码）
scripts/smoke.js         xvfb 下的端到端冒烟测试（逐步截图）
test/                    状态机单元测试（node:test）
stories/                 Storybook：三个窗口的各种状态（仅开发用，不进安装包）
```

## 开发

```bash
npm install
npm test              # 状态机单元测试
npm start             # 本地运行（需要图形环境）
npm run storybook     # 界面目录（默认 6006 端口）
npm run icons         # 重新生成图标
xvfb-run -a node scripts/smoke.js   # 无头环境端到端冒烟 + 截图
```

### Storybook

三个窗口（主窗口、「该休息了」小窗、休息遮罩）的各种状态在浏览器里逐格摆开，不用真等 25 分钟、
也不用装 Windows 才能看到某个状态长什么样：拖堂变红、长休息、副屏遮罩、更新就绪的设置页都点一下就到。

story 里的界面就是应用里的界面——HTML 和 CSS 由 Vite 以 `?raw` 原样读 `src/renderer` 下的文件
（只摘掉 `<script>` 和 CSP `<meta>`），渲染调的是 `src/renderer/views/*-view.js`，
也就是应用运行时用的同一批函数。这几个视图模块只吃 `(root, 数据)`、不碰 `window.api`，
`main.js` / `overlay.js` / `due.js` 则只剩 IPC 接线，两边因此不会走样。
每个 story 装在一个同源 `<iframe>` 里，宽高照抄主进程建窗时的尺寸（三个窗口的样式都写在 `body` 上，
不隔开会互相污染）。假数据在 `stories/lib/fixtures.js`，形状照搬主进程 `fullState()` 广播的那份。

在线版跟着 main 分支走：每次推到 main，GitHub Actions（`.github/workflows/storybook.yml`）
就重新构建并发布到 GitHub Pages，地址是 <https://xbghc.github.io/pomodoro-timer/>。
本地要出一份静态站用 `npm run build-storybook`，产物在 `storybook-static/`。

Storybook 只是开发期工具：Vite 与 Storybook 都在 devDependencies，`stories/` 与 `.storybook/`
不在 electron-builder 的打包范围里，应用本身仍然不带打包器、不带前端框架。

## 构建 Windows 安装包

发版走 `git push origin v<版本>`，GitHub Actions 在 windows-latest 上构建，`npm ci` 会自动装上 Windows 版的 koffi 二进制，无需额外步骤。

在 Linux 上交叉打包则要多一步：koffi 的原生二进制按平台拆成了 `@koromix/koffi-<platform>` 可选依赖，npm 只装本机那个，得手动补上 Windows 版——

```bash
npm install --no-save --force --os=win32 --cpu=x64 @koromix/koffi-win32-x64
```

注意它会顶掉本机平台的那个包，打完包跑 `npm install` 装回来，否则本地 `npm start` 和冒烟测试会报「Cannot find the native Koffi module」。

electron-builder 给安装器嵌入图标/版本资源时需要 Wine，本机没装 Wine 的话用官方 Docker 镜像（已验证可用）：

```bash
docker run --rm \
  -v "$PWD":/project \
  -v ~/.cache/electron:/root/.cache/electron \
  -v ~/.cache/electron-builder:/root/.cache/electron-builder \
  -w /project \
  -e ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  -e ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  electronuserland/builder:wine \
  bash -c 'node_modules/.bin/electron-builder --win nsis; ec=$?; chown -R '"$(id -u):$(id -g)"' /project/dist /root/.cache 2>/dev/null; exit $ec'
```

产出 `dist/PomodoroTimer-Setup-<版本>.exe`（x64）。装了 Wine 的机器直接 `npm run dist` 即可。

## 安装与使用（Windows 10/11）

1. 双击 `PomodoroTimer-Setup-*.exe`，静默安装到当前用户后自动启动
2. 安装包未做代码签名，首次运行 SmartScreen 可能提示「未知发布者」——点「更多信息 → 仍要运行」即可
3. 数据保存在 `%APPDATA%\番茄钟\`（settings.json / history.json），卸载不会删除数据

## 已知限制

- 自动更新从 GitHub Releases 下载（electron-updater），网络访问不了 GitHub 时会静默失败、周期重试，也可以随时手动下载安装包覆盖安装
- 应用退出/重启后，进行中的番茄不会恢复（历史记录不受影响）
- **Windows 虚拟桌面**：窗口跟随是轮询实现的（系统不发桌面切换事件），切过去后约半秒才跟上。真正的「显示在所有桌面」只有未公开的 COM 接口能做，那些接口的 GUID 随 Windows build 变，装个系统更新就可能静默失效，所以没用。跟随一旦不可用（接口取不到、koffi 加载失败）会整体降级为不跟随，功能其余部分照常，此时靠系统通知兜底
- 无代码签名（个人使用场景，签名证书成本不划算）；因此更新包只校验 latest.yml 里的 SHA512，不校验发布者签名
