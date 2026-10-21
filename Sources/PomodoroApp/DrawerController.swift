import AppKit
import SwiftUI
import PomodoroCore

@MainActor
private final class DrawerPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func animationResizeTime(_ newFrame: NSRect) -> TimeInterval { 0.16 }
}

@MainActor
private final class HoverHostingView<Content: View>: NSHostingView<Content> {
    var entered: (() -> Void)?
    var exited: (() -> Void)?
    private var hoverArea: NSTrackingArea?

    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverArea { removeTrackingArea(hoverArea) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        hoverArea = area
    }
    override func mouseEntered(with event: NSEvent) { entered?() }
    override func mouseExited(with event: NSEvent) { exited?() }
}

@MainActor
private final class DrawerPresentation: ObservableObject {
    @Published var expanded = false
    @Published var announcement: String?
}

@MainActor
final class DrawerController {
    private let panel: DrawerPanel
    private let model: AppModel
    private let presentation = DrawerPresentation()
    private var collapseTask: DispatchWorkItem?

    init(model: AppModel) {
        self.model = model
        panel = DrawerPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.isMovable = false
        panel.title = "工作与休息 · 桌边抽屉"
        let content = DrawerContent(model: model, presentation: presentation,
                                    collapse: { [weak self] in self?.setExpanded(false) })
        let host = HoverHostingView(rootView: content)
        host.entered = { [weak self] in self?.pointerEntered() }
        host.exited = { [weak self] in self?.scheduleCollapse(after: 0.3) }
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        reposition()
    }

    func reposition() {
        guard let frame = targetFrame(expanded: presentation.expanded) else { panel.orderOut(nil); return }
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
    }

    func announce(_ text: String) {
        presentation.announcement = text
        setExpanded(true)
        scheduleCollapse(after: 6)
    }

    func hide() { collapseTask?.cancel(); panel.orderOut(nil) }

    private func pointerEntered() {
        collapseTask?.cancel()
        setExpanded(true)
    }
    private func setExpanded(_ expanded: Bool) {
        collapseTask?.cancel()
        guard let frame = targetFrame(expanded: expanded) else { return }
        presentation.expanded = expanded
        if !expanded { presentation.announcement = nil }
        panel.hasShadow = expanded
        // Real window resizing removes the hidden part from hit testing when collapsed.
        panel.setFrame(frame, display: true, animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        panel.orderFrontRegardless() // Never activates the app, requests a key window, or moves a Space.
    }
    private func scheduleCollapse(after delay: TimeInterval) {
        collapseTask?.cancel()
        let task = DispatchWorkItem { [weak self] in
            guard let self, !self.panel.frame.contains(NSEvent.mouseLocation) else { return }
            self.setExpanded(false)
        }
        collapseTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: task)
    }
    private func targetFrame(expanded: Bool) -> CGRect? {
        let screens = NSScreen.screens.enumerated().map { index, screen in
            DesktopScreen(id: index, frame: screen.frame, visibleFrame: screen.visibleFrame)
        }
        guard let screen = DrawerGeometry.screen(in: screens, preferredID: 0) else { return nil }
        return DrawerGeometry.frame(on: screen, expanded: expanded)
    }
}

@MainActor
private struct DrawerContent: View {
    @ObservedObject var model: AppModel
    @ObservedObject var presentation: DrawerPresentation
    let collapse: () -> Void
    var body: some View {
        Group {
            if presentation.expanded {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Label(model.phaseTitle, systemImage: model.active?.kind == .rest ? "leaf" : "circle.dotted")
                            .foregroundStyle(model.tint).font(.headline)
                        Spacer()
                        Button(action: collapse) { Image(systemName: "chevron.right") }.buttonStyle(.plain).help("收起抽屉")
                    }
                    Text(model.active == nil ? "留一点余地" : AppModel.duration(model.elapsed))
                        .font(.system(size: 32, weight: .light, design: .rounded)).monospacedDigit()
                    Text(presentation.announcement ?? model.detail).font(.callout).foregroundStyle(.secondary)
                        .lineLimit(2).frame(maxWidth: .infinity, minHeight: 35, alignment: .leading)
                    HStack {
                        if model.active?.kind == .work {
                            Button("休息 \(model.configuration.breakMinutes) 分钟") { model.startRest() }
                                .buttonStyle(.borderedProminent)
                            Button("再专注 1 小时") { model.deferReminder() }
                        } else {
                            Button("开始工作") { model.startWork() }.buttonStyle(.borderedProminent)
                            if model.active?.kind == .rest {
                                Button("全屏休息") { model.enterFullScreenRest?() }
                            } else { Button("开始休息") { model.startRest() } }
                        }
                    }.disabled(model.isBlocked)
                    HStack {
                        if model.active?.kind == .work {
                            Button("全屏休息") { model.startRest(fullScreen: true) }.disabled(model.isBlocked)
                        }
                        if model.active != nil { Button("结束") { model.stop() }.disabled(model.isBlocked) }
                        Spacer()
                    }.buttonStyle(.link).font(.caption)
                    Divider()
                    HStack {
                        Text("今日工作 \(AppModel.minutes(model.summary(for: model.now).work))")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("日历与模板") { model.openCalendar?() }.buttonStyle(.link).font(.caption)
                    }
                }
                .padding(20)
                .frame(width: DrawerGeometry.expandedSize.width, height: DrawerGeometry.expandedSize.height)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            } else {
                ZStack {
                    Rectangle().fill(.regularMaterial)
                    Capsule().fill(model.tint.opacity(0.8)).frame(width: 4, height: 42)
                }
                .frame(width: DrawerGeometry.collapsedSize.width, height: DrawerGeometry.collapsedSize.height)
                .accessibilityLabel("\(model.phaseTitle)，桌边抽屉；在菜单栏也可打开日历")
            }
        }.clipped()
    }
}
