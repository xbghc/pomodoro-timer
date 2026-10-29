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
                    Text("Calendar & History").font(.system(size: 18, weight: .semibold))
                    Text("Planned and tracked time, side by side.").font(.caption).foregroundStyle(PomodoroTheme.secondary)
                }
                Spacer()
                Text(EnglishFormat.shortDate(model.now)).foregroundStyle(.secondary)
            }.padding(22)
            if let message = model.blockingError {
                errorBanner(message, retry: true)
            } else if let message = model.errorMessage {
                errorBanner(message, retry: false)
            }
            TabView(selection: $navigation.tab) {
                TodayView(model: model).tabItem { Label("Now", systemImage: "circle.dotted") }.tag(WorkspaceTab.today)
                HistoryView(model: model).tabItem { Label("Calendar", systemImage: "calendar") }.tag(WorkspaceTab.history)
                ConfigurationView(model: model).tabItem { Label("Schedule", systemImage: "slider.horizontal.3") }.tag(WorkspaceTab.configuration)
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
            if retry { Button("Retry") { model.load() } }
            else { Button("Dismiss") { model.errorMessage = nil } }
        }.padding(12).background(Color.orange.opacity(0.1)).padding(.horizontal, 20)
    }
}

private enum DurationPurpose: String, Identifiable {
    case work, rest, reminder
    var id: String { rawValue }
    var title: String {
        switch self {
        case .work: return "Start work"
        case .rest: return "Start break"
        case .reminder: return "Focus for"
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
                            Text("\(active.kind.title) since \(AppModel.time(active.start))")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        Text(model.detail).font(.callout).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 28)
                    VStack(alignment: .trailing, spacing: 6) {
                        Text("Tracked today").font(.caption).foregroundStyle(.secondary)
                        Text("Work  \(AppModel.minutes(model.summary(for: model.now).work))")
                        Text("Break  \(AppModel.minutes(model.summary(for: model.now).rest))").foregroundStyle(.secondary)
                    }.font(.callout)
                }
                if model.active?.kind == .rest {
                    Text("\(Int(ceil(model.restRemaining / 60))) min remaining").font(.title3).foregroundStyle(PomodoroTheme.rest)
                }
                controls.disabled(model.isBlocked)
                Divider()
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Today's schedule").font(.headline)
                        Spacer()
                        Text(model.configuration.displayName(for: model.selectedTemplate)).foregroundStyle(.secondary)
                    }
                    if model.isReady {
                        let blocks = ScheduleResolver().blocks(on: model.now, configuration: model.configuration, selection: model.snapshot.selection)
                        if blocks.isEmpty { Text("No scheduled hours today. Start work whenever you are ready.").foregroundStyle(.secondary) }
                        ForEach(blocks) { block in
                            HStack {
                                Image(systemName: block.contains(model.now) ? "circle.inset.filled" : "circle")
                                    .foregroundStyle(block.contains(model.now) ? PomodoroTheme.work : PomodoroTheme.secondary)
                                Text("\(AppModel.time(block.start)) – \(AppModel.time(block.end))").monospacedDigit()
                                Spacer()
                                if block.contains(model.now) { Text("Current block").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                Text("You will be reminded when it is time for a break. Take it when ready, then start work again yourself.")
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
                    Button("Take a \(model.configuration.breakMinutes) min break") { model.startRest() }.buttonStyle(.borderedProminent)
                    Menu("Focus for") {
                        ForEach([30, 60, 90], id: \.self) { minutes in
                            Button("\(minutes) min") { model.deferReminder(minutes: minutes) }
                        }
                        Button("Other duration…") { durationPurpose = .reminder }
                    }.frame(width: 145)
                } else {
                    Button("Start work") { model.startWork() }.buttonStyle(.borderedProminent)
                    if model.active == nil {
                        Button("Start break") { model.startRest() }
                        Button("Custom work duration…") { durationPurpose = .work }
                    }
                }
                if model.active != nil { Button("End activity") { model.stop() } }
            }
            if model.active?.kind != .rest {
                Button("Custom break duration…") { durationPurpose = .rest }.buttonStyle(.link)
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
            TextField("Minutes", text: $minutes).textFieldStyle(.roundedBorder)
            Text("1–\(maximum) minutes. Scheduled end times still take priority.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Confirm") { if let value = Int(minutes), valid { save(value); dismiss() } }
                    .buttonStyle(.borderedProminent).disabled(!valid).keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 360).modifier(SurfaceAppearance())
        .onAppear { minutes = purpose == .rest ? "5" : "30" }
    }
}
