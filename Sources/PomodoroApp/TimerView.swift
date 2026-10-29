import SwiftUI
import PomodoroCore

@MainActor
struct MainView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        CompactTimerView(model: model)
            .frame(width: 360, height: 190)
            .ignoresSafeArea()
    }
}

@MainActor
struct CompactTimerView: View {
    @ObservedObject var model: AppModel
    var announcement: String?
    var collapse: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                PhaseIndicators(model: model)
                HStack(spacing: 0) {
                    // The standalone window uses real AppKit traffic lights here.
                    if let collapse {
                        Button(action: collapse) { Image(systemName: "chevron.right").frame(width: 44, height: 40) }
                            .buttonStyle(.plain)
                            .foregroundStyle(PomodoroTheme.secondary)
                            .help("收起抽屉").accessibilityLabel("收起抽屉")
                    }
                    Spacer()
                    Button { model.openSettings?() } label: {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 15))
                            .frame(width: 44, height: 40)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PomodoroTheme.secondary)
                    .help("设置…（⌘,）").accessibilityLabel("设置")
                }.padding(.horizontal, 4)
            }.frame(height: 40)

            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 7) {
                    TimerDigits(model: model, size: 72)
                    TimerCaption(model: model, announcement: announcement)
                }.frame(maxWidth: .infinity, alignment: .leading)
                TimerActions(model: model, size: 56, secondaryFill: .clear, spacing: 4)
            }
            .padding(.leading, 24)
            .padding(.trailing, 14)
            .padding(.bottom, 10)
            .frame(maxHeight: .infinity)

            GeometryReader { geometry in
                Rectangle().fill(model.tint)
                    .frame(width: geometry.size.width * model.readout.progress)
            }
            .frame(height: 3)
            .background(PomodoroTheme.line)
            .accessibilityHidden(true)
        }
        .modifier(SurfaceAppearance())
        .contextMenu {
            if model.active?.kind == .work {
                Button("休息 \(model.configuration.breakMinutes) 分钟") { model.startRest() }.disabled(model.isBlocked)
                Button("再专注 1 小时") { model.deferReminder() }.disabled(model.isBlocked)
                Divider()
            }
            Button("日历与记录…") { model.openCalendar?() }
            Button("临时时长…") { model.openActivity?() }
            Button("设置…") { model.openSettings?() }
        }
    }
}

@MainActor
struct TimerDigits: View {
    @ObservedObject var model: AppModel
    let size: CGFloat

    private var description: String {
        if !model.isReady { return "计时不可用，请查看错误详情" }
        let meaning = model.active == nil ? "下一次工作" : (model.readout.isOvertime ? "超出提醒" : "剩余")
        return "\(model.phaseTitle)，\(meaning) \(model.readout.text)"
    }

    var body: some View {
        Text(model.isReady ? model.readout.text : "--:--")
            .font(PomodoroTheme.timerFont(size: size))
            .monospacedDigit()
            .tracking(-size * 0.03)
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            .foregroundStyle(PomodoroTheme.ink)
            .accessibilityLabel(description)
    }
}

@MainActor
struct TimerCaption: View {
    @ObservedObject var model: AppModel
    var announcement: String?

    var body: some View {
        Group {
            if model.isBlocked || model.errorMessage != nil {
                Button { model.openActivity?() } label: {
                    Label("\(model.isBlocked ? "已暂停" : "操作失败") · 查看详情", systemImage: "exclamationmark.circle")
                }.buttonStyle(.plain).foregroundStyle(PomodoroTheme.work)
                    .help(model.blockingError ?? model.errorMessage ?? model.detail)
            } else {
                Text(announcement ?? model.timerCaption)
                    .foregroundStyle(PomodoroTheme.secondary)
                    .help(announcement ?? model.detail)
            }
        }
        .font(.system(size: 11))
        .lineLimit(1)
    }
}

/// Three real phases, not a fictional four-round/long-break counter.
@MainActor
struct PhaseIndicators: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(model.active?.kind == .work ? model.tint : PomodoroTheme.line)
            Circle().fill(model.active?.kind == .rest ? model.tint : PomodoroTheme.line)
            Circle().fill(model.active == nil ? PomodoroTheme.secondary : PomodoroTheme.line)
        }
        .frame(width: 29, height: 5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("工作、休息、等待；当前\(model.phaseTitle)")
        .help("工作 · 休息 · 等待：当前\(model.phaseTitle)")
    }
}

@MainActor
struct TimerActions: View {
    @ObservedObject var model: AppModel
    var size: CGFloat = 44
    var secondaryFill = PomodoroTheme.hover
    var spacing: CGFloat = 20

    private var nextLabel: String {
        model.active?.kind == .rest ? "结束休息并开始工作" : "休息 \(model.configuration.breakMinutes) 分钟"
    }

    var body: some View {
        HStack(spacing: spacing) {
            RoundTimerButton(symbol: model.active == nil ? "play.fill" : "stop.fill",
                             label: model.active == nil ? "开始工作" : "结束当前活动",
                             size: size, fill: model.tint, foreground: .white) {
                if model.active == nil { model.startWork() } else { model.stop() }
            }
            RoundTimerButton(symbol: model.active == nil ? "cup.and.saucer" : "forward.end",
                             label: nextLabel, size: 44, fill: secondaryFill,
                             foreground: PomodoroTheme.secondary) {
                if model.active?.kind == .rest { model.startWork() } else { model.startRest() }
            }
        }.disabled(model.isBlocked)
    }
}

private struct RoundTimerButton: View {
    let symbol: String
    let label: String
    let size: CGFloat
    let fill: Color
    let foreground: Color
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovered = false
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size == 56 ? 19 : 16, weight: .medium))
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(foreground)
        .background(fill, in: Circle())
        .overlay(Circle().fill(PomodoroTheme.ink.opacity(hovered && isEnabled ? 0.08 : 0)).allowsHitTesting(false))
        .overlay(Circle().strokeBorder(PomodoroTheme.ink, lineWidth: focused ? 2 : 0).padding(-3).allowsHitTesting(false))
        .opacity(isEnabled ? 1 : 0.4)
        .focused($focused)
        .onHover { hovered = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}
