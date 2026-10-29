import SwiftUI
import PomodoroCore

enum WorkspaceTab: Hashable { case today, history, configuration }

@MainActor
final class WorkspaceNavigation: ObservableObject {
    @Published var tab: WorkspaceTab = .history
}

@MainActor
struct WorkspaceView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var navigation: WorkspaceNavigation
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "timer").font(.title2).foregroundStyle(PomodoroTheme.work)
                VStack(alignment: .leading, spacing: 3) {
                    Text("日历与记录").font(.system(size: 18, weight: .semibold))
                    Text("计划与实际，各自清晰。").font(.caption).foregroundStyle(PomodoroTheme.secondary)
                }
                Spacer()
                Text(model.now.formatted(date: .abbreviated, time: .omitted)).foregroundStyle(.secondary)
            }.padding(22)
            if let message = model.blockingError {
                errorBanner(message, retry: true)
            } else if let message = model.errorMessage {
                errorBanner(message, retry: false)
            }
            TabView(selection: $navigation.tab) {
                TodayView(model: model).tabItem { Label("当前", systemImage: "circle.dotted") }.tag(WorkspaceTab.today)
                HistoryView(model: model).tabItem { Label("日历", systemImage: "calendar") }.tag(WorkspaceTab.history)
                ConfigurationView(model: model).tabItem { Label("工作模板", systemImage: "slider.horizontal.3") }.tag(WorkspaceTab.configuration)
            }.padding([.horizontal, .bottom], 16)
        }
        .frame(minWidth: 760, minHeight: 650)
        .modifier(SurfaceAppearance())
    }

    private func errorBanner(_ message: String, retry: Bool) -> some View {
        HStack(alignment: .top) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
            Text(message).font(.callout).textSelection(.enabled)
            Spacer()
            if retry { Button("重试读取") { model.load() } }
            else { Button("关闭") { model.errorMessage = nil } }
        }.padding(12).background(Color.orange.opacity(0.1)).padding(.horizontal, 20)
    }
}

private enum DurationPurpose: String, Identifiable {
    case work, rest, reminder
    var id: String { rawValue }
    var title: String {
        switch self {
        case .work: return "开始工作"
        case .rest: return "开始休息"
        case .reminder: return "接下来专注"
        }
    }
}

@MainActor
private struct TodayView: View {
    @ObservedObject var model: AppModel
    @State private var durationPurpose: DurationPurpose?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 12) {
                        Label(model.phaseTitle, systemImage: model.active?.kind == .rest ? "leaf" : "circle.dotted")
                            .foregroundStyle(model.tint).font(.headline)
                        TimerDigits(model: model, size: 64)
                        Text(model.timerCaption).font(.callout).foregroundStyle(PomodoroTheme.secondary)
                        if let active = model.active {
                            Text("自 \(AppModel.time(active.start)) 起，连续\(active.kind.title)")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        Text(model.detail).font(.callout).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 28)
                    VStack(alignment: .trailing, spacing: 6) {
                        Text("今日实际").font(.caption).foregroundStyle(.secondary)
                        Text("工作  \(AppModel.minutes(model.summary(for: model.now).work))")
                        Text("休息  \(AppModel.minutes(model.summary(for: model.now).rest))").foregroundStyle(.secondary)
                    }.font(.callout)
                }
                if model.active?.kind == .rest {
                    Text("还剩 \(Int(ceil(model.restRemaining / 60))) 分钟").font(.title3).foregroundStyle(PomodoroTheme.rest)
                }
                controls.disabled(model.isBlocked)
                Divider()
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("今日计划").font(.headline)
                        Spacer()
                        Text(model.selectedTemplate).foregroundStyle(.secondary)
                    }
                    if model.isReady {
                        let blocks = ScheduleResolver().blocks(on: model.now, configuration: model.configuration, selection: model.snapshot.selection)
                        if blocks.isEmpty { Text("今天没有固定时段，可以手动开始工作。").foregroundStyle(.secondary) }
                        ForEach(blocks) { block in
                            HStack {
                                Image(systemName: block.contains(model.now) ? "circle.inset.filled" : "circle")
                                    .foregroundStyle(block.contains(model.now) ? PomodoroTheme.work : PomodoroTheme.secondary)
                                Text("\(AppModel.time(block.start)) – \(AppModel.time(block.end))").monospacedDigit()
                                Spacer()
                                if block.contains(model.now) { Text("当前时段").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                Text("计划到点会提醒。休息由你决定；休息结束后，需要手动开始工作。")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }
        .sheet(item: $durationPurpose) { purpose in
            DurationSheet(purpose: purpose) { minutes in
                switch purpose {
                case .work: model.startWork(minutes: minutes)
                case .rest: model.startRest(minutes: minutes)
                case .reminder: model.deferReminder(minutes: minutes)
                }
            }
        }
    }

    @ViewBuilder private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if model.active?.kind == .work {
                    Button("休息 \(model.configuration.breakMinutes) 分钟") { model.startRest() }.buttonStyle(.borderedProminent)
                    Menu("接下来专注") {
                        ForEach([30, 60, 90], id: \.self) { minutes in
                            Button("\(minutes) 分钟") { model.deferReminder(minutes: minutes) }
                        }
                        Button("其他时长…") { durationPurpose = .reminder }
                    }.frame(width: 145)
                } else {
                    Button("开始工作") { model.startWork() }.buttonStyle(.borderedProminent)
                    if model.active == nil {
                        Button("开始休息") { model.startRest() }
                        Button("自定工作时长…") { durationPurpose = .work }
                    }
                }
                if model.active != nil { Button("结束当前活动") { model.stop() } }
            }
            if model.active?.kind != .rest {
                Button("自定休息时长…") { durationPurpose = .rest }.buttonStyle(.link)
            }
        }
    }
}

@MainActor
private struct DurationSheet: View {
    let purpose: DurationPurpose
    let save: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var minutes = "30"
    private var maximum: Int { purpose == .rest ? 240 : 480 }
    private var valid: Bool { Int(minutes).map { (1...maximum).contains($0) } ?? false }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(purpose.title).font(.title2)
            TextField("分钟", text: $minutes).textFieldStyle(.roundedBorder)
            Text("1–\(maximum) 分钟。固定工作时段的结束时间仍然优先。")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("确定") { if let value = Int(minutes), valid { save(value); dismiss() } }
                    .buttonStyle(.borderedProminent).disabled(!valid).keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 360).modifier(SurfaceAppearance())
        .onAppear { minutes = purpose == .rest ? "5" : "30" }
    }
}
