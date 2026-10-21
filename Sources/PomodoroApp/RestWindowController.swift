import AppKit
import SwiftUI

@MainActor
private final class RestPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class RestWindowController {
    private let model: AppModel
    private var panels: [NSPanel] = []
    private(set) var isVisible = false

    init(model: AppModel) { self.model = model }

    func show() {
        guard model.active?.kind == .rest, !model.isBlocked else { return }
        isVisible = true
        rebuild()
    }
    func hide() {
        panels.forEach { $0.orderOut(nil) }
        panels.removeAll()
        isVisible = false
    }
    func update() {
        if model.active?.kind == .work || model.isBlocked { hide() }
    }
    func screensChanged() { if isVisible { rebuild() } }

    private func rebuild() {
        panels.forEach { $0.orderOut(nil) }
        panels.removeAll()
        let screens = NSScreen.screens
        let controlScreen = screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? screens.first
        for screen in screens {
            let primary = screen === controlScreen
            let panel = RestPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.isReleasedWhenClosed = false
            panel.isOpaque = true
            panel.backgroundColor = NSColor(calibratedRed: 0.055, green: 0.07, blue: 0.08, alpha: 1)
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            panel.contentView = NSHostingView(rootView: RestView(model: model, primary: primary, dismiss: { [weak self] in self?.hide() }))
            panel.setFrame(screen.frame, display: true)
            panels.append(panel)
            panel.orderFrontRegardless()
            if primary { panel.makeKey() } // Only reached after the user's explicit full-screen action.
        }
    }
}

@MainActor
private struct RestView: View {
    @ObservedObject var model: AppModel
    let primary: Bool
    let dismiss: () -> Void
    private var resting: Bool { model.active?.kind == .rest }

    var body: some View {
        ZStack {
            Color(red: 0.055, green: 0.07, blue: 0.08)
            VStack(spacing: 28) {
                Image(systemName: "leaf").font(.system(size: 32, weight: .light)).foregroundStyle(.teal.opacity(0.8))
                Text(resting ? "还剩 \(Int(ceil(model.restRemaining / 60))) 分钟" : "休息结束")
                    .font(.system(size: 48, weight: .light, design: .rounded)).monospacedDigit()
                if primary {
                    Text(resting ? "回想一下，刚才这段工作的收获。" : "准备好时，再开始工作。")
                        .font(.title3).foregroundStyle(.white.opacity(0.55))
                    HStack(spacing: 18) {
                        Button("回到桌面", action: dismiss).keyboardShortcut(.cancelAction)
                        if !resting {
                            Button("开始工作") {
                                model.startWork()
                                if model.active?.kind == .work { dismiss() }
                            }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                        }
                    }.padding(.top, 20)
                }
            }.padding(40)
        }
        .foregroundStyle(.white.opacity(0.9))
        .preferredColorScheme(.dark)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
    }
}
