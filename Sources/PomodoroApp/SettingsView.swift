import SwiftUI

@MainActor
struct SettingsView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Text("设置").font(.system(size: 13, weight: .medium)).frame(height: 44)
            ConfigurationView(model: model)
        }
        .frame(width: 480, height: 520)
        .modifier(SurfaceAppearance())
        .ignoresSafeArea()
    }
}

@MainActor
struct ConfigurationView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if let message = model.blockingError ?? model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("需要处理", systemImage: "exclamationmark.circle").fontWeight(.medium)
                        Text(message).textSelection(.enabled)
                        Button("重试读取") { model.load() }
                    }.foregroundStyle(PomodoroTheme.work)
                }
                VStack(alignment: .leading, spacing: 0) {
                    durationRow("工作提醒", minutes: model.configuration.workMinutes)
                    SurfaceDivider()
                    durationRow("休息", minutes: model.configuration.breakMinutes)
                    HStack {
                        Text("默认时长在工作模板中设置。")
                            .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        Spacer()
                        Button("打开 JSON") { model.openJSON() }
                        Button("重新加载") { model.reloadConfiguration() }
                    }.controlSize(.small).padding(.top, 12)
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("今日模板")
                        Spacer(minLength: 24)
                        Picker("今日模板", selection: Binding(get: { model.selectedTemplate }, set: { model.selectTemplate($0) })) {
                            ForEach(model.configuration.templates.keys.sorted(), id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden().frame(maxWidth: 210).disabled(model.isBlocked)
                    }.frame(minHeight: 44)
                    SurfaceDivider()
                    HStack {
                        Text("星期映射")
                        Spacer()
                        Button("恢复今天的星期映射") { model.selectTemplate(nil) }.disabled(model.isBlocked)
                            .controlSize(.small)
                    }.frame(minHeight: 44)
                    Text("模板切换仅影响今天。未来日程与默认时长在 JSON 中编辑，修改后重新加载。")
                        .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Toggle("菜单栏显示倒计时", isOn: $model.showsMenuBarTimer)
                        .toggleStyle(.switch).controlSize(.small).frame(minHeight: 44)
                    SurfaceDivider()
                    HStack {
                        Text("本地数据")
                        Spacer()
                        Button("打开数据文件夹") { model.showDataFolder() }.controlSize(.small)
                    }.frame(minHeight: 44)
                    HStack {
                        Text("历史记录一直保留在这台 Mac 上。")
                            .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        Spacer()
                        Button("日历与记录…") { model.openCalendar?() }.buttonStyle(.link).font(.system(size: 11))
                    }.padding(.top, 8)
                }
            }
            .frame(maxWidth: 540)
            .padding(.horizontal, 28).padding(.top, 16).padding(.bottom, 28)
            .frame(maxWidth: .infinity)
        }.modifier(SurfaceAppearance())
    }

    private func durationRow(_ title: String, minutes: Int) -> some View {
        HStack(spacing: 8) {
            Text(title)
            Spacer()
            // This is a read-only value; JSON remains the source of configuration.
            Text("\(minutes)").monospacedDigit()
                .frame(width: 56, height: 28)
                .background(.white, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(PomodoroTheme.line))
            Text("分钟").foregroundStyle(PomodoroTheme.secondary).frame(width: 26, alignment: .leading)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title)，\(minutes) 分钟，在 JSON 中修改")
    }
}
