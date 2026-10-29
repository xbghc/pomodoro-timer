import SwiftUI

@MainActor
struct SettingsView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Text("Settings").font(.system(size: 13, weight: .medium)).frame(height: 44)
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
                        Label("Action required", systemImage: "exclamationmark.circle").fontWeight(.medium)
                        Text(message).textSelection(.enabled)
                        Button("Retry") { model.load() }
                    }.foregroundStyle(PomodoroTheme.work)
                }
                VStack(alignment: .leading, spacing: 0) {
                    durationRow("Work reminder", minutes: model.configuration.workMinutes)
                    SurfaceDivider()
                    durationRow("Break", minutes: model.configuration.breakMinutes)
                    HStack {
                        Text("Durations are set in your schedule.")
                            .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        Spacer()
                        Button("Open JSON") { model.openJSON() }
                        Button("Reload") { model.reloadConfiguration() }
                    }.controlSize(.small).padding(.top, 12)
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Today's template")
                        Spacer(minLength: 24)
                        Picker("Today's template", selection: Binding(get: { model.selectedTemplate }, set: { model.selectTemplate($0) })) {
                            ForEach(model.configuration.templates.keys.sorted(), id: \.self) { name in
                                Text(model.configuration.displayName(for: name)).tag(name)
                            }
                        }
                        .labelsHidden().frame(maxWidth: 210).disabled(model.isBlocked)
                    }.frame(minHeight: 44)
                    SurfaceDivider()
                    HStack {
                        Text("Weekday schedule")
                        Spacer()
                        Button("Restore weekday default") { model.selectTemplate(nil) }.disabled(model.isBlocked)
                            .controlSize(.small)
                    }.frame(minHeight: 44)
                    Text("Template changes apply only today. Edit the JSON for future schedules and default durations, then reload.")
                        .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Timer in menu bar")
                        Spacer()
                        Toggle("Timer in menu bar", isOn: $model.showsMenuBarTimer)
                            .labelsHidden().toggleStyle(.switch).controlSize(.small)
                            .accessibilityLabel("Timer in menu bar")
                    }.frame(minHeight: 44)
                    SurfaceDivider()
                    HStack {
                        Text("Local data")
                        Spacer()
                        Button("Open Data Folder") { model.showDataFolder() }.controlSize(.small)
                    }.frame(minHeight: 44)
                    HStack {
                        Text("History stays on this Mac.")
                            .font(.system(size: 11)).foregroundStyle(PomodoroTheme.secondary)
                        Spacer()
                        Button("Calendar & History…") { model.openCalendar?() }.buttonStyle(.link).font(.system(size: 11))
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
            Text("min").foregroundStyle(PomodoroTheme.secondary).frame(width: 26, alignment: .leading)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(minutes) minutes. Edit in JSON.")
    }
}
