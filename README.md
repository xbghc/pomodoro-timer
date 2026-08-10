# 番茄钟

到点强制休息的 Windows 桌面番茄钟。核心理念：**时间到了就把你从屏幕前拉起来**——全屏休息遮罩 + 提示音，休息、复盘、走动，回到座位再手动开始下一个。

Electron + 纯 JavaScript（无前端框架、无打包器），数据全部保存在本机，不联网。

## 功能规格

### 核心循环
- 经典 25/5/15 节奏：25 分钟工作 + 5 分钟短休息，每完成 4 个番茄进入 15 分钟长休息（时长均可在设置中修改）
- 番茄到点 → 提示音 + **全屏休息遮罩**（覆盖所有显示器，副屏只显示倒计时），休息倒计时立即开始
- 遮罩上可点「再给 3 分钟收尾」回去把手头的事收个尾（每个番茄限一次），收尾结束重新进入完整休息
- 休息中可「跳过休息」直接开始下一个番茄（按钮弱化，不鼓励）
- 休息结束后遮罩停留，显示「开始下一个番茄」，回到座位手动点击才继续计时——人不在时计时不空跑
- 工作中可暂停/继续，也可放弃当前番茄（放弃不计入完成数）
- 「结束专注」任何时候可用，退出循环回到空闲

### 复盘与历史
- 休息遮罩上有一句话速记框：随手记下这个番茄做了什么（可跳过），自动挂到刚完成的番茄上
- 主窗口「历史」页按天翻看：每个番茄的起止时间、速记内容、完成/放弃状态、每日完成数与专注时长
- 数据以 JSON 存储在本地用户目录，不上传任何数据

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
src/main/preload.js      contextBridge 安全桥
src/renderer/main.*      主窗口（计时/历史/设置三个页签）
src/renderer/overlay.*   全屏休息遮罩
src/renderer/sound.js    WebAudio 合成提示音（无音频素材）
scripts/generate-icons.js 程序化生成番茄图标（零依赖 PNG/ICO 编码）
scripts/smoke.js         xvfb 下的端到端冒烟测试（逐步截图）
test/                    状态机单元测试（node:test）
```

## 开发

```bash
npm install
npm test              # 状态机单元测试
npm start             # 本地运行（需要图形环境）
npm run icons         # 重新生成图标
xvfb-run -a node scripts/smoke.js   # 无头环境端到端冒烟 + 截图
```

## 构建 Windows 安装包

在 Linux 上交叉打包。electron-builder 给安装器嵌入图标/版本资源时需要 Wine，本机没装 Wine 的话用官方 Docker 镜像（已验证可用）：

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
- 无代码签名（个人使用场景，签名证书成本不划算）；因此更新包只校验 latest.yml 里的 SHA512，不校验发布者签名
