import SwiftUI

@MainActor
struct MenuBarView: View {
    @ObservedObject var model: AppModel
    let showTimer: () -> Void
    let showCalendar: () -> Void
    let showSettings: () -> Void
    let quit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                TimerDigits(model: model, size: 52)
                    .frame(maxWidth: .infinity)
                PhaseIndicators(model: model)
                TimerCaption(model: model)
            }.padding(.horizontal, 14).padding(.top, 22).padding(.bottom, 16)
            TimerActions(model: model).padding(.bottom, 16)
            SurfaceDivider().padding(.horizontal, 8)
            VStack(spacing: 0) {
                if model.active?.kind == .work {
                    MenuRow("Focus for 1 Hour", action: { model.deferReminder() }).disabled(model.isBlocked)
                }
                MenuRow("Open Timer", shortcut: "⌘0", action: showTimer)
                MenuRow("Calendar & History…", shortcut: "⌘1", action: showCalendar)
                MenuRow("Settings…", shortcut: "⌘,", action: showSettings)
                MenuRow("Quit", shortcut: "⌘Q", action: quit)
            }.padding(.vertical, 4)
        }
        .padding(6)
        .frame(width: 248)
        .modifier(SurfaceAppearance())
    }
}

private struct MenuRow: View {
    let title: String
    var shortcut = ""
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovered = false
    @FocusState private var focused: Bool

    init(_ title: String, shortcut: String = "", action: @escaping () -> Void) {
        self.title = title; self.shortcut = shortcut; self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Text(shortcut).foregroundStyle(PomodoroTheme.secondary)
            }
            .padding(.horizontal, 12)
            .frame(height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(hovered || focused ? PomodoroTheme.hover : .clear, in: RoundedRectangle(cornerRadius: 6))
        .opacity(isEnabled ? 1 : 0.4)
        .focused($focused)
        .onHover { hovered = $0 }
    }
}
