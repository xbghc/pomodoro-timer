# Pomodoro Timer · macOS 原生番茄钟

一个动态工作日程表：工作、休息、等待分开记录。SwiftUI 界面，AppKit 原生桌边抽屉，纯 Swift 领域层；只面向 macOS，不依赖 Electron、Flutter 或 WebView。

应用界面统一使用英文，包括菜单、提醒、错误和无障碍标签；日期使用英文，时刻采用 24 小时制，仍按本地时区执行日程。旧版内置模板会显示英文名称，已有配置标识与历史记录保持有效，自定义名称按用户输入保留。

鼠标蹭到桌面右缘，小窗像抽屉一样展开。提醒不抢键盘焦点；你决定何时休息。休息结束后等你手动恢复，等待时间不计入统计。

## 运行与构建

安装包见 [GitHub Releases](https://github.com/xbghc/pomodoro-timer/releases)：按处理器选择 `macos-arm64.zip`（Apple Silicon）或 `macos-x86_64.zip`（Intel），解压后将 `PomodoroTimer.app` 放入“应用程序”。安装包为 ad-hoc 签名、未经 Apple 公证；下载、校验和与首次打开说明见 [v2.1.1 发布说明](docs/releases/v2.1.1.md)。

应用最低运行系统为 **macOS 13.0**。源码最低工具链为 **Swift 6.0 / Xcode 16.0**，采用 Swift 6 严格并发语言模式；Xcode 16.0 开发机要求 **macOS 14.5+**，与应用运行下限不同。没有第三方包依赖。

```bash
swift test                       # 领域、持久化、确定性时钟和布局测试
swift run PomodoroTimer           # 开发运行；菜单栏与桌边把手为入口
./scripts/build-macos.sh          # 本地 release .app；不上传或发布
open dist/PomodoroTimer.app
```

也可以用 Xcode 打开 `Package.swift`，选择 `PomodoroTimer` 运行。验收跨 Spaces/其他应用全屏时优先使用脚本生成的 `.app`，其中包含 accessory 应用所需的 Info.plist。

`./scripts/verify.sh` 在 macOS 运行测试并编译应用；在 Linux 只运行核心测试与原生源码语法解析。Linux 没有 SwiftUI/AppKit SDK，不能构建或验收原生界面。本轮的真实测试结果见 [验证记录](docs/validation.md)，尚待真实 Mac 完成 [原生验收清单](docs/macos-acceptance.md)。

## 使用

- 默认工作 30 分钟后温和提醒，休息 5 分钟；可以提前休息或使用临时时长。提醒后仍继续记录工作，不自动切换状态。
- “Focus for 1 Hour”从点击时刻重设下一提醒，不重置累计时间、不拆记录。例如 10:00 开始、10:20 延长、11:20 休息，记为一条 80 分钟工作记录。
- 固定时段自动开始/停止，固定截止优先于延长提醒。中途打开只从启动时刻开始记录。
- 休息结束进入等待，手动开始才记录工作；下一个固定起点仍按日程接管。
- 计时小窗与桌边抽屉采用 360×190 布局：大数字倒计时、底部进度线，工作为珊瑚红、休息为绿色。工作提醒后显示 `+` 超时量，仍继续记录工作。
- 圆形主按钮在等待时开始工作，活动中结束当前记录；旁边的跳过按钮在工作时开始休息、休息时立即开始工作。它们没有“暂停后续接原记录”的语义，悬停可查看操作名称。
- 点击菜单栏可打开计时面板，进入计时小窗、日历与记录或独立设置窗口。小窗右上角打开设置，右键菜单包含日历、临时时长与再专注入口。`⌘0` 打开小窗、`⌘1` 打开日历、`⌘,` 打开设置。
- 设置可切换今天的模板、显示或隐藏菜单栏倒计时，打开并重载 JSON。关窗口不退出，菜单栏“退出”才结束应用。
- 日历将只读计划与实际活动分列。所有已结束实际记录均可补录、改起止/类型、删除，统计立即更新；未来或重叠记录有明确错误提示。

## JSON 工作模板

在 Settings 窗口或 Calendar & History 的 Schedule 页点 Open JSON，外部编辑后点 Reload。未来计划与默认时长仅通过 JSON 修改。应用内的模板选择只作用于**今天**，不修改 JSON 或未来日期。

[示例配置](Resources/schedule.example.json) 的常规时段是 10:00–12:10、13:30–18:10、19:30–22:30。星期 `0` 为周日、`6` 为周六，未指定的星期使用 `defaultTemplate`。初始映射是可编辑示例，没有擅自确定工作日、周末或特殊周五安排。

```json
{
  "workMinutes": 30,
  "breakMinutes": 5,
  "defaultTemplate": "Regular day",
  "weekdays": { "0": "Regular day", "1": "Regular day", "2": "Regular day", "3": "Regular day", "4": "Regular day", "5": "Regular day", "6": "Regular day" },
  "templates": {
    "Regular day": [
      { "start": "10:00", "end": "12:10" },
      { "start": "13:30", "end": "18:10" },
      { "start": "19:30", "end": "22:30" }
    ],
    "No fixed hours": []
  }
}
```

时刻严格采用同一天的 `HH:mm`，按开始排序，不允许重叠；空模板支持纯手动工作。工作时长 1–480 分钟、休息 1–240 分钟。配置无效不会覆盖用户文件；重载保留最后有效内存配置，启动时损坏则明确暂停并提供修复入口。

## 本地数据

```text
~/Library/Application Support/PomodoroTimerNative/
  schedule.json     # 工作模板
  activities.json   # 全部历史、今天的模板覆盖、运行检查点
  .instance.lock    # 防止两个实例并发写入
```

历史不自动删除。每 5 秒写检查点，操作和活动边界立即写入；历史与运行状态在同一 JSON 文件中原子保存。正常退出/休眠关闭活动，异常退出恢复到最后保存的观察时间，不补记离线；保存失败会暂停后续修改。时间回退、跨午夜、夏令时和模板切换的详细行为见 [设计与工程默认值](docs/design.md)。

不提供旧版兼容或数据迁移，不读取或删除用户的 Electron 数据。旧应用代码已从本分支移除，仍可在 Git 历史中查看。

## 项目结构

```text
Package.swift
Sources/PomodoroCore/       # 配置、领域、状态机、事务持久化、抽屉几何
Sources/PomodoroApp/        # SwiftUI 界面与 AppKit 原生窗口/生命周期
Tests/PomodoroCoreTests/    # 无真实等待的确定性测试
Resources/                 # .app Info.plist 与可编辑 JSON 示例
scripts/build-macos.sh     # 本地 .app 打包
scripts/verify.sh          # 按平台区分验证
docs/                      # 设计、真实验证结果、macOS 人工验收
```

## 持续验证

[Swift 工作流](.github/workflows/build.yml) 已替换旧 Windows/Electron 构建，旧 Storybook/Pages 部署和 Electron 镜像配置已删除。它包含：

- Linux + Swift 6.0.3：核心测试与原生源码语法检查。
- Intel macOS + Xcode 16.0：最低工具链下的测试、真实 SwiftUI/AppKit 编译与链接。
- Apple Silicon macOS + Xcode 16.4：测试、真实编译与链接。
- 两条 Mac 路径均构建 release `.app`，使用本地 ad-hoc 签名，检查签名、架构和 macOS 13.0 最低部署目标。

所有 Mac 构建均生成 ZIP 并解压验证可执行权限和签名。普通构建不上传应用；手动启用 `capture_ui` 时上传真实截图和诊断，保留 14 天，见 [截图验收步骤](docs/macos-acceptance.md)。

发布沿用 `v*` 标签约定：版本必须匹配 `Resources/Info.plist`，标签提交必须已经合入 main，并提供 `docs/releases/<标签>.md`。标签触发双架构完整测试和打包；两项构建均通过后，独立发布 job 使用 GitHub 自带 token 的 `contents: write` 权限创建草稿，上传两个 ZIP 和 `SHA256SUMS`，重新下载校验成功后才公开 Release。已存在的 Release 或草稿会停止流程，不覆盖资产。构建 job 仍只有 `contents: read`，没有新增签名凭据、公证、Pages、付费 runner 或平台环境设置。CI 构建和截图不替代完整窗口交互及 macOS 13 实机验收。
