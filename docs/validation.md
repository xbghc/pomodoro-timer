# 实际验证记录

## 2026-10-22：移除全屏休息

开始时位于 `codex/macos-swiftui-rewrite`，基线 `1049da7`，工作区干净；未发现额外 `AGENTS.md` 或仓库技能。本次仍为 Debian GNU/Linux 13 x86_64，没有 macOS SDK 或 `xcodebuild`。旧临时工具链已不在新环境中，重新从 Swift 官方下载同一 Swift 6.0.3 至 `/tmp/pomodoro-swift-toolchain`，没有修改平台环境设置。

- 删除多屏休息窗口文件、主窗口/抽屉的全屏入口、应用模型专用回调和参数，以及退出、睡眠、屏幕变化和状态刷新中的专用窗口处理。
- 领域状态与持久化格式没有修改；普通休息到点事件和倒计时继续服务主窗口/抽屉。加强已有确定性测试，核对休息仅提醒一次、等待期间记录/统计不增长、手动恢复从点击时刻开始并获得完整 30 分钟。
- 使用下方相同的 `verify.sh` 命令和 `/tmp` 缓存参数，启用 Swift 6 语言模式与 `-Xswiftc -warnings-as-errors`。脚本退出 **0**，2026-10-22 04:25:39 UTC：**58 项 XCTest，0 失败，无编译警告**；测试组数量保持 29 / 9 / 17 / 3。临时完整日志：`/tmp/pomodoro-remove-fullscreen-verification.log`。
- 原生源码的 `swiftc -frontend -parse` 通过，**仅语法解析**；`bash -n scripts/verify.sh scripts/build-macos.sh` 和 `git diff --check` 通过。
- 搜索确认 Swift 源码中没有全屏休息入口、控制器或专用回调残留。抽屉仍保留 `.fullScreenAuxiliary`，用于其他应用全屏空间中的悬停唤出，符合原设计。
- README、设计、静态审查和 macOS 验收清单同步更新；新增人工检查普通休息不会打开覆盖其他应用/显示器的窗口。

macOS SDK 类型检查、链接、打包和原生 UI 验收**仍未执行**：Linux 无法运行 SwiftUI/AppKit。具体步骤见 [macOS 验收清单](macos-acceptance.md)。这是平台能力限制，不是权限拒绝；本轮没有推送、合并、发布或触发远端 CI，CI 文件与平台保存配置未修改。

## 2026-10-21：原生重写与静态审查

日期：2026-10-21。环境：Debian GNU/Linux 13、x86_64；工作目录 `/workspace/pomodoro-timer`。

### 基线与范围

- 开始时分支为 `work`，提交 `0931ff38cb3d04f3e6b15db9fb43ae29defff216`，工作区干净。
- 未发现仓库/上级 `AGENTS.md`，`/workspace/.agents/skills` 不存在；没有额外仓库技能可执行。
- 新分支为 `codex/macos-swiftui-rewrite`。没有推送、合并、发布或修改云环境、远端权限。
- 旧产品基线 `node --test`：38 项通过。此结果只用于审查旧实现，不作为 Swift 产品验收。
- 首次原生实现提交 `3eec263` 的核心测试为 47 项；后续静态审查与修复将当前测试增加到 58 项，下面记录最终结果。
- PATH 原本没有 Swift。从 Swift 官方下载的 Swift 6.0.3 Ubuntu 24.04 x86_64 工具链临时解压至 `/tmp/pomodoro-swift-toolchain`，实际 `swift --version` 为 `Swift version 6.0.3 (swift-6.0.3-RELEASE)`。工具链、构建和缓存均在 `/tmp`，没有加入仓库或修改系统安装/共享环境配置。

### 已执行且通过

最终通过统一验证脚本运行：

```bash
PATH=/tmp/pomodoro-swift-toolchain/usr/bin:$PATH \
CLANG_MODULE_CACHE_PATH=/tmp/pomodoro-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/pomodoro-module-cache \
./scripts/verify.sh \
  --scratch-path /tmp/pomodoro-swift-build \
  --cache-path /tmp/pomodoro-swift-cache \
  --config-path /tmp/pomodoro-swift-config \
  --security-path /tmp/pomodoro-swift-security \
  -Xswiftc -warnings-as-errors
```

脚本退出码 **0**。全部目标采用 Swift 6 语言模式；核心编译启用 warnings-as-errors，无警告。2026-10-21 15:50:25 UTC 的 XCTest 结果：

```text
Test Suite 'All tests' passed
Executed 58 tests, with 0 failures (0 unexpected)
核心测试与原生源码语法解析完成。Linux 未编译或运行 SwiftUI/AppKit。
```

| 测试组 | 数量 | 覆盖 |
| --- | ---: | --- |
| ActivityEngineTests | 29 | 30/5、连续 80 分钟记录、提醒只发一次、固定截止优先、提前休息、手动恢复、模板切换/本地跨日、睡眠/工作和休息中崩溃恢复、回拨、七天混合操作、失效提醒筛选、休息实际截止与固定起点接管 |
| ConfigurationTests | 9 | JSON 样例与代码默认一致、字段/模板/星期/时刻错误、重叠/排序、半开区间、夏令时缺失与重复小时 |
| HistoryAndPersistenceTests | 17 | 自动/手动历史 CRUD、统计、未来/重叠/当前活动拒绝、毫秒往返、损坏文件/极端日期/矛盾检查点拒绝、配置回退、检查点、写失败暂停、退出恢复、历史操作同时到点的提醒、回拨写保护、半小时夏令时 |
| DrawerGeometryTests | 3 | 收起真实命中区域、外侧屏幕选择、负坐标、上下排列和空屏幕列表 |

另外执行：

- `swiftc -frontend -parse -swift-version 6 -target arm64-apple-macosx13.0 Sources/PomodoroApp/*.swift`：通过，**仅语法解析**。
- `bash -n scripts/build-macos.sh scripts/verify.sh`：通过。
- Python `plistlib` 解析 Info.plist，核对 `LSUIElement` 和可执行文件名；JSON 示例解析：通过。
- 在 Linux 执行 `scripts/build-macos.sh`：按预期返回 **1** 并解释必须在 macOS 构建，没有假造 `.app` 产物。
- `actionlint 1.7.12 .github/workflows/build.yml`：通过，检查 GitHub 工作流语法、表达式和 runner/action 配置。工具下载到 `/tmp/pomodoro-review-tools` 并对照官方 release checksums 校验，没有修改系统工具配置。
- `git diff --check`：通过。旧 Windows 和 Storybook 发布路径、Electron `.npmrc` 已按后续授权替换/删除。

首次尝试 Swift 测试曾因默认 Clang 模块缓存指向只读的 `/home/agent/.cache` 失败。随后仅通过命令级环境变量和 SwiftPM 参数把缓存指向 `/tmp`，全部测试成功。没有申请提升权限，也没有自动审批拒绝或结果不确定的写入。

后续新增的 Lord Howe 半小时夏令时测试最初失败：Foundation `.nextTime` 将缺失的 02:10 解析为次日。改成逐分钟寻找当天有效时刻后，包含该项的最终 58 项全部通过。详细修复与 API/并发审查见 [静态审查记录](static-review.md)。

### 未执行，不能视为通过

- macOS SDK 下的 SwiftUI/AppKit **类型检查、链接、应用启动**。
- `.app` 打包脚本中的 `plutil`、`codesign` 和 Finder 启动。
- 真实跨 Spaces、其他应用全屏、焦点、多显示器、Dock、Stage Manager、键盘/VoiceOver 和窗口动画验收。
- macOS 系统睡眠/唤醒、退出通知与单实例锁的实机集成。领域层对应语义已测，但不能替代系统验收。

执行平台没有 macOS SDK/图形系统。上述状态是**待 macOS 验证**，不是权限拒绝，也没有尝试远端构建或伪造截图。[验收步骤](macos-acceptance.md) 已逐项列出。

仓库 CI 已提供可执行的 Mac 验证路径：标准 `macos-15-intel` / Xcode 16.0 与 `macos-15` / Xcode 16.4，运行测试、真实 SwiftUI/AppKit 编译/链接、release 打包、ad-hoc 签名验证、架构和 Mach-O 最低部署版本检查。工作流无发布、上传、公证或签名秘密。本轮没有推送，**远端 CI 尚未运行**，不能把 actionlint 通过当作 Mac job 已通过。平台保存的环境设置与外部权限未改动。
