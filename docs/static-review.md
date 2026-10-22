# 最终代码静态审查

2026-10-21，对 `3eec263` 后续改动及全部 Swift 源码、测试、打包脚本、Info.plist 和工作流逐项审查。执行平台为 Linux；这是源码与可运行核心验证，**不是 macOS SDK 类型检查或应用运行验收**。

2026-10-22，按最新要求移除全屏休息后，复查主窗口/抽屉入口、应用模型回调和生命周期引用。多屏休息窗口及其显示状态、屏幕变化处理、退出/睡眠清理均已删除；普通休息提醒和抽屉跨其他应用全屏的行为保留。对应复测见 [验证记录](validation.md)。

随后获准推送分支并执行远端 CI。Xcode 16.0 / 16.4 的实际编译补充了 Linux 静态检查，发现并修复下表中的 CoreGraphics 导入与 lipo 参数问题。CI 结果与人工交互验收仍分别记录。

## 确认并修复的问题

| 范围 | 问题与结果 |
| --- | --- |
| 边界提醒 | 历史增改删内部 tick 原来丢弃提醒事件，可能将提醒标记为已发送却未显示。现在返回并交付事务成功后的事件，有时钟驱动的回归测试。 |
| 操作与提醒相撞 | 开始休息、停止、暂停或模板切换发生在工作提醒截止时，原来可能显示失效的“该休息了”。现在按最终活动状态筛选事件。 |
| 休息显示 | 固定结束早于休息截止时，倒计时原来仍显示完整休息剩余量。现在统一使用较早的截止，并计入下一固定起点的接管；安全暂停时停止推进显示。 |
| 半小时夏令时 | 新增 Lord Howe 测试实际复现 Linux Foundation `.nextTime` 把不存在的 02:10 跳到次日，令计划缺失。现在逐分钟寻找当天有效时刻，重复小时仍取第一次；日历不再向下取整 23.5 小时的高度。 |
| 检查点校验 | 有限但极端的损坏日期可能进入 Calendar；过期活动/矛盾提醒标记也未充分拒绝。现在限制日历范围，并核对活动截止和提醒标记与观察时刻一致。 |
| 并发与回调 | 全部目标切换到 Swift 6 严格并发模式。抽屉延迟改为可取消的 MainActor Task；系统通知用主队列同步桥接，特别是睡眠检查点不能被异步跳转推迟。分布式“显示主窗”通知显式跳到 MainActor。 |
| 焦点/收起 | 保留 nonactivatingPanel 和禁止成为 key/main window；重复 hover 不重启动画，Space/屏幕变更后可按指针位置收起。只有用户打开主窗才调用 activate，并区分 macOS 13 与 14+ API。 |
| CI | 移除 Windows 发布、Storybook/Pages 部署与 Electron npm 镜像配置；新增 Linux 核心、Intel 最低工具链和 Apple Silicon macOS 编译/链接/本地打包。无上传、发布、签名秘密或远端环境设置。 |
| macOS 几何 API | Foundation 在 Apple 平台中未提供 CGRect 的完整 Swift 接口与 Equatable 一致性，导致首次 Mac 编译失败。布局源文件及测试现在按 canImport(CoreGraphics) 显式导入；Linux 继续使用 Foundation 的几何实现。 |
| 架构检查 | lipo 的 -verify_arch 将后续参数视为架构列表，原来的末尾文件名被误解析。现在把二进制路径放在选项前，实际架构、Mach-O minos 与 Info.plist 部署目标仍严格检查。 |

## 审查覆盖与证据边界

- **SwiftUI 类型/API**：检查了 View builder 分支、`@State`/`@ObservedObject`、DatePicker、Form、颜色/形状样式、菜单、sheet、日历坐标及整数/CGFloat 转换。影响最低版本的 [GroupedFormStyle](https://developer.apple.com/documentation/swiftui/groupedformstyle) 自 macOS 13 提供；其余使用的 SwiftUI 能力不要求更高的运行版本。后续远端 Mac CI 已实际执行原生类型检查和链接，证据见 [验证记录](validation.md)。
- **AppKit API**：核对了 [NSTrackingArea 初始化参数](https://developer.apple.com/documentation/appkit/nstrackingarea/init(rect:options:owner:userinfo:))、NSPanel/NSWindow 属性与集合行为；未把语法解析当作 SDK 链接证据。
- **Actor 隔离**：核对 Apple 文档中 `applicationDidFinishLaunching`、`menuWillOpen` 的 MainActor 声明，UI 所有者统一隔离。Swift 6.0.3 本地 `_Concurrency.swiftinterface` 声明 `MainActor.assumeIsolated` 可用于 macOS 10.15+，仅在 `queue: .main` 保证的回调内使用。Linux 核心及远端 Xcode 16.0 / 16.4 原生目标均以 Swift 6 语言模式和 warnings-as-errors 编译通过；系统回调的运行行为仍需实机验收。
- **时间与持久化**：检查固定终点优先、连续记录不拆分、休息等待、当天模板的本地日界线、跨午夜、23/25/23.5 小时日、回拨阻止写入、正常睡眠/退出、异常检查点恢复、原子文件与稳定 ID。新增测试核对休息中崩溃不能补记至原计划休息结束。
- **窗口行为**：收起时真实 NSPanel 尺寸为 12×92；布局选择物理屏幕外侧，支持负坐标。悬停/提醒/Space 切换都不调用 activate。实际跨 Spaces、其他应用全屏、Dock、Stage Manager、混合缩放与焦点仍必须实机验收。

## 最低版本与 CI 选择

- 应用部署/运行下限：**macOS 13.0**（Package.swift、Info.plist 和 CI 的 Mach-O 检查一致）。最低系统的实际运行尚未验证。
- 编译器下限：**Swift 6.0 / Xcode 16.0**；Package.swift 使用 `.v6`。
- 开发机：Xcode 16.0 需要 **macOS Sonoma 14.5+**，这是开发工具要求，不是应用运行下限。[Apple Xcode 系统要求](https://developer.apple.com/xcode/system-requirements/)
- CI 采用标准 `macos-15-intel` 与 `macos-15`，分别选择 Xcode 16.0 和 16.4。核对了 [GitHub runner 标签](https://github.com/actions/runner-images#available-images) 与 [Xcode 安装列表](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)，没有使用 large/xlarge 或自托管服务。Xcode 选择仅使用 job 环境变量 `DEVELOPER_DIR`。

实际测试数量、命令与未验证项见 [验证记录](validation.md)；[macOS 验收清单](macos-acceptance.md) 保留所有尚未执行的原生项。
