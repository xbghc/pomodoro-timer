# 实际验证记录

日期：2026-10-21。环境：Debian GNU/Linux 13、x86_64；工作目录 `/workspace/pomodoro-timer`。

## 基线与范围

- 开始时分支为 `work`，提交 `0931ff38cb3d04f3e6b15db9fb43ae29defff216`，工作区干净。
- 未发现仓库/上级 `AGENTS.md`，`/workspace/.agents/skills` 不存在；没有额外仓库技能可执行。
- 新分支为 `codex/macos-swiftui-rewrite`。没有推送、合并、发布或修改云环境、远端权限。
- 旧产品基线 `node --test`：38 项通过。此结果只用于审查旧实现，不作为 Swift 产品验收。
- PATH 原本没有 Swift。从 Swift 官方下载的 Swift 6.0.3 Ubuntu 24.04 x86_64 工具链临时解压至 `/tmp/pomodoro-swift-toolchain`，实际 `swift --version` 为 `Swift version 6.0.3 (swift-6.0.3-RELEASE)`。工具链、构建和缓存均在 `/tmp`，没有加入仓库或修改系统安装/共享环境配置。

## 已执行且通过

最终通过统一验证脚本运行：

```bash
PATH=/tmp/pomodoro-swift-toolchain/usr/bin:$PATH \
CLANG_MODULE_CACHE_PATH=/tmp/pomodoro-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/pomodoro-module-cache \
./scripts/verify.sh \
  --scratch-path /tmp/pomodoro-swift-build \
  --cache-path /tmp/pomodoro-swift-cache \
  --config-path /tmp/pomodoro-swift-config \
  --security-path /tmp/pomodoro-swift-security
```

脚本退出码 **0**。2026-10-21 15:29:06 UTC 的 XCTest 结果：

```text
Test Suite 'All tests' passed
Executed 47 tests, with 0 failures (0 unexpected)
核心测试与原生源码语法解析完成。Linux 未编译或运行 SwiftUI/AppKit。
```

| 测试组 | 数量 | 覆盖 |
| --- | ---: | --- |
| ActivityEngineTests | 24 | 30/5、连续 80 分钟记录、提醒只发一次、固定截止优先、提前休息、手动恢复、模板切换/跨日、睡眠/重启、时钟回退、七天混合操作不变量 |
| ConfigurationTests | 9 | JSON 样例与代码默认一致、字段/模板/星期/时刻错误、重叠/排序、半开区间、夏令时缺失与重复小时 |
| HistoryAndPersistenceTests | 11 | 自动/手动历史 CRUD、统计、未来/重叠/当前活动拒绝、毫秒往返、损坏文件不覆盖、配置回退、检查点、写失败暂停、退出恢复 |
| DrawerGeometryTests | 3 | 收起真实命中区域、外侧屏幕选择、负坐标、上下排列和空屏幕列表 |

另外执行：

- `swiftc -frontend -parse -target arm64-apple-macosx13.0 Sources/PomodoroApp/*.swift`：通过，**仅语法解析**。
- `bash -n scripts/build-macos.sh scripts/verify.sh`：通过。
- Python `plistlib` 解析 Info.plist，核对 `LSUIElement` 和可执行文件名；JSON 示例解析：通过。
- 在 Linux 执行 `scripts/build-macos.sh`：按预期返回 **1** 并解释必须在 macOS 构建，没有假造 `.app` 产物。
- `git diff --check`：通过；`.github/workflows/` 与 `.npmrc` 没有差异。

首次尝试 Swift 测试曾因默认 Clang 模块缓存指向只读的 `/home/agent/.cache` 失败。随后仅通过命令级环境变量和 SwiftPM 参数把缓存指向 `/tmp`，全部测试成功。没有申请提升权限，也没有自动审批拒绝或结果不确定的写入。

## 未执行，不能视为通过

- macOS SDK 下的 SwiftUI/AppKit **类型检查、链接、应用启动**。
- `.app` 打包脚本中的 `plutil`、`codesign` 和 Finder 启动。
- 真实跨 Spaces、其他应用全屏、焦点、多显示器、Dock、Stage Manager、键盘/VoiceOver 和窗口动画验收。
- macOS 系统睡眠/唤醒、退出通知与单实例锁的实机集成。领域层对应语义已测，但不能替代系统验收。

执行平台没有 macOS SDK/图形系统。上述状态是**待 macOS 验证**，不是权限拒绝，也没有尝试远端构建或伪造截图。[验收步骤](macos-acceptance.md) 已逐项列出。

共享 Windows 发布和 Storybook 部署工作流按任务约束保留；由于旧应用已移除，这些流程不适用于新产品。后续需要单独更新共享 CI，当前本地入口是 Swift Package 与 `scripts/verify.sh`。
