import SwiftUI
import PomodoroCore

@MainActor
struct HistoryView: View {
    @ObservedObject var model: AppModel
    @State private var day = Calendar.current.startOfDay(for: Date())
    @State private var editing: ActivityRecord?
    @State private var deleting: ActivityRecord?
    private var calendar: Calendar { .current }
    private var dayInterval: DateInterval { calendar.dateInterval(of: .day, for: day)! }
    private var records: [ActivityRecord] {
        model.snapshot.records.filter { $0.start < dayInterval.end && $0.end > dayInterval.start }
    }
    private var planned: [PlannedBlock] {
        model.isReady ? ScheduleResolver().blocks(on: day, configuration: model.configuration, selection: model.snapshot.selection) : []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button { move(-1) } label: { Image(systemName: "chevron.left") }.help("Previous day")
                DatePicker("Date", selection: $day, in: Date.distantPast...Date.distantFuture, displayedComponents: .date)
                    .labelsHidden().frame(width: 160)
                Button { move(1) } label: { Image(systemName: "chevron.right") }.help("Next day")
                Button("Today") { day = calendar.startOfDay(for: model.now) }
                Spacer()
                Button { addRecord() } label: { Label("Add Record", systemImage: "plus") }
                    .disabled(model.isBlocked || dayInterval.start > model.now)
            }
            HStack(spacing: 24) {
                Text("Work  \(AppModel.minutes(model.summary(for: day).work))").foregroundStyle(PomodoroTheme.work)
                Text("Break  \(AppModel.minutes(model.summary(for: day).rest))").foregroundStyle(PomodoroTheme.rest)
                Spacer()
                Text("Idle time is not counted").font(.caption).foregroundStyle(.secondary)
            }.font(.callout)
            Divider()
            HStack {
                Text("Time").frame(width: 48, alignment: .leading)
                Text("Planned · read only").frame(maxWidth: .infinity, alignment: .leading)
                Text("Tracked · click to edit").frame(maxWidth: .infinity, alignment: .leading)
            }.font(.caption).foregroundStyle(.secondary)
            ScrollViewReader { proxy in
                ScrollView {
                    timeline
                    recordList.padding(.top, 18)
                }.onAppear { proxy.scrollTo(8, anchor: .top) }
            }
            Text("Plans use the current schedule. Only tracked time counts. Records must be in the past and must not overlap.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(20)
        .sheet(item: $editing) { RecordEditor(model: model, record: $0) }
        .alert("Delete this record?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Cancel", role: .cancel) { deleting = nil }
            Button("Delete", role: .destructive) {
                if let deleting { model.delete(deleting) }
                deleting = nil
            }
        } message: { Text("Your daily totals will be updated.") }
    }

    private var timeline: some View {
        // Some DST transitions change the day by 30 minutes, not a whole hour.
        let hours = Int(ceil(dayInterval.duration / 3600))
        let height = CGFloat(dayInterval.duration / 3600) * 44
        return GeometryReader { geometry in
            let column = (geometry.size.width - 64) / 2
            ZStack(alignment: .topLeading) {
                ForEach(0..<hours, id: \.self) { hour in
                    HStack(alignment: .top) {
                        Text(AppModel.time(dayInterval.start.addingTimeInterval(Double(hour) * 3600)))
                            .font(.system(size: 10)).monospacedDigit().foregroundStyle(.secondary)
                            .frame(width: 48, alignment: .leading)
                        Rectangle().fill(Color.secondary.opacity(0.12)).frame(height: 1)
                    }.frame(height: 44, alignment: .top).offset(y: CGFloat(hour) * 44).id(hour)
                }
                ForEach(planned) { block in
                    intervalView(start: block.start, end: block.end, width: column - 10,
                                 color: .secondary, label: "Planned work", planned: true)
                        .offset(x: 56, y: offset(block.start))
                        .accessibilityLabel("Planned work, read only, \(AppModel.time(block.start)) to \(AppModel.time(block.end))")
                }
                ForEach(records) { record in
                    Button { editing = record } label: {
                        intervalView(start: record.start, end: record.end, width: column - 10,
                                     color: record.kind == .work ? PomodoroTheme.work : PomodoroTheme.rest, label: record.kind.title)
                    }.buttonStyle(.plain).disabled(model.isBlocked)
                        .offset(x: 56 + column, y: offset(record.start))
                        .accessibilityLabel("Edit \(record.kind.title), \(AppModel.time(record.start)) to \(AppModel.time(record.end))")
                }
                if let active = model.active, active.start < dayInterval.end, model.observedNow > dayInterval.start {
                    intervalView(start: active.start, end: model.observedNow, width: column - 10,
                                 color: active.kind == .work ? PomodoroTheme.work : PomodoroTheme.rest, label: "\(active.kind.title) · in progress")
                        .offset(x: 56 + column, y: offset(active.start))
                }
            }
        }.frame(height: height)
    }

    private func offset(_ date: Date) -> CGFloat {
        CGFloat(max(0, date.timeIntervalSince(dayInterval.start))) / 3600 * 44
    }
    private func intervalView(start: Date, end: Date, width: CGFloat, color: Color,
                              label: String, planned: Bool = false) -> some View {
        let duration = max(0, min(end, dayInterval.end).timeIntervalSince(max(start, dayInterval.start)))
        let height = max(12, CGFloat(duration) / 3600 * 44 - 2)
        return VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).lineLimit(1)
            if height > 30 {
                Text("\(AppModel.time(start)) – \(AppModel.time(end))").font(.system(size: 10)).monospacedDigit().lineLimit(1)
            }
        }
        .padding(.horizontal, 7)
        .frame(width: width, height: height, alignment: .leading)
        .foregroundStyle(color)
        .background(color.opacity(planned ? 0.06 : 0.14), in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(color.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: planned ? [4, 3] : [])))
        .clipped()
    }

    private var recordList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tracked sessions").font(.headline)
            if records.isEmpty { Text("No completed sessions on this day.").foregroundStyle(.secondary) }
            ForEach(records) { record in
                HStack {
                    Circle().fill(record.kind == .work ? PomodoroTheme.work : PomodoroTheme.rest).frame(width: 7, height: 7)
                    Text(record.kind.title).frame(width: 38, alignment: .leading)
                    Text("\(AppModel.time(record.start)) – \(AppModel.time(record.end))").monospacedDigit()
                    Spacer()
                    Text(AppModel.minutes(record.duration)).foregroundStyle(.secondary)
                    Button("Edit") { editing = record }
                    Button("Delete", role: .destructive) { deleting = record }
                }.font(.callout).disabled(model.isBlocked)
            }
        }
    }
    private func move(_ amount: Int) {
        if let next = calendar.date(byAdding: .day, value: amount, to: day),
           (Date.distantPast...Date.distantFuture).contains(next) { day = next }
    }
    private func addRecord() {
        let end = min(model.now, dayInterval.end, model.active?.start ?? model.now)
        guard end > dayInterval.start else {
            model.errorMessage = "This day overlaps your active session. End the session first, or choose another day."
            return
        }
        let suggested = min(dayInterval.start.addingTimeInterval(9 * 3600), end.addingTimeInterval(-1800))
        let start = max(dayInterval.start, suggested)
        editing = ActivityRecord(kind: .work, start: start, end: min(start.addingTimeInterval(1800), end))
    }
}

@MainActor
private struct RecordEditor: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State var record: ActivityRecord
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Activity Record").font(.title2)
            Picker("Type", selection: $record.kind) {
                ForEach(ActivityKind.allCases, id: \.self) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented)
            DatePicker("Start", selection: $record.start, displayedComponents: [.date, .hourAndMinute])
            DatePicker("End", selection: $record.end, displayedComponents: [.date, .hourAndMinute])
            Text("Unchanged times keep their seconds and milliseconds. Future or overlapping records cannot be saved.")
                .font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red).font(.callout).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save") {
                    if model.save(record) { dismiss() }
                    else { error = model.blockingError ?? model.errorMessage ?? "Unable to save this record." }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(model.isBlocked)
            }
        }.padding(24).frame(width: 440).modifier(SurfaceAppearance())
    }
}
