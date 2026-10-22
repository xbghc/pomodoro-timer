# 工作与休息 · macOS 原生番茄钟

一个动态工作日程表：工作、休息、等待分开记录。SwiftUI 界面，AppKit 原生桌边抽屉，纯 Swift 领域层；只面向 macOS，不依赖 Electron、Flutter 或 WebView。

鼠标蹭到桌面右缘，小窗像抽屉一样展开。提醒不抢键盘焦点；你决定何时休息。休息结束后等你手动恢复，等待时间不计入统计。

## 运行与构建

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
- “再专注 1 小时”从点击时刻重设下一提醒，不重置累计时间、不拆记录。例如 10:00 开始、10:20 延长、11:20 休息，记为一条 80 分钟工作记录。
- 固定时段自动开始/停止，固定截止优先于延长提醒。中途打开只从启动时刻开始记录。
- 休息结束进入等待，手动开始才记录工作；下一个固定起点仍按日程接管。
- 在“当前”页或抽屉点击“休息 5 分钟”开始休息；“当前”页显示休息剩余时间。
- 菜单栏或抽屉的“日历与模板”打开主窗口；关窗口不退出，菜单栏“退出”才结束应用。
- 日历将只读计划与实际活动分列。所有已结束实际记录均可补录、改起止/类型、删除，统计立即更新；未来或重叠记录有明确错误提示。

## JSON 工作模板

在主窗口“工作模板”页点“打开 JSON”，外部编辑后“重新加载”。未来计划仅通过 JSON 修改。应用内的模板选择只作用于**今天**，不修改 JSON 或未来日期。

[示例配置](Resources/schedule.example.json) 的常规时段是 10:00–12:10、13:30–18:10、19:30–22:30。星期 `0` 为周日、`6` 为周六，未指定的星期使用 `defaultTemplate`。初始映射是可编辑示例，没有擅自确定工作日、周末或特殊周五安排。

```json
{
  "workMinutes": 30,
  "breakMinutes": 5,
  "defaultTemplate": "常规日",
  "weekdays": { "0": "常规日", "1": "常规日", "2": "常规日", "3": "常规日", "4": "常规日", "5": "常规日", "6": "常规日" },
  "templates": {
    "常规日": [
      { "start": "10:00", "end": "12:10" },
      { "start": "13:30", "end": "18:10" },
      { "start": "19:30", "end": "22:30" }
    ],
    "无固定时段": []
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

工作流仅有 `contents: read` 权限，没有 Release、Pages、产物上传、公证或签名秘密，也不使用大型/自托管付费 runner。它可由 PR、main 分支提交或手动触发。本次只修改本地文件，**没有推送或运行远端工作流**，也没有改动平台保存的云环境配置。原生构建结果仍待 macOS 执行后确认；[静态审查记录](docs/static-review.md) 不替代编译或实机验收。
