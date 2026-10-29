import SwiftUI
import PomodoroCore

/// Colors and typography follow the supplied compact macOS reference.
enum PomodoroTheme {
    static let background = Color(red: 240 / 255, green: 240 / 255, blue: 242 / 255)
    static let ink = Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
    static let secondary = Color(red: 110 / 255, green: 110 / 255, blue: 115 / 255)
    static let line = Color(red: 220 / 255, green: 220 / 255, blue: 225 / 255)
    static let work = Color(red: 232 / 255, green: 81 / 255, blue: 63 / 255)
    static let rest = Color(red: 22 / 255, green: 149 / 255, blue: 107 / 255)
    static let hover = Color(red: 230 / 255, green: 230 / 255, blue: 234 / 255)

    static func timerFont(size: CGFloat) -> Font { .system(size: size, weight: .light) }
}

struct SurfaceDivider: View {
    var body: some View { Rectangle().fill(PomodoroTheme.line).frame(height: 1) }
}

struct SurfaceAppearance: ViewModifier {
    func body(content: Content) -> some View {
        content
            .environment(\.locale, EnglishFormat.locale)
            .font(.system(size: 13))
            .foregroundStyle(PomodoroTheme.ink)
            .tint(PomodoroTheme.work)
            .background(PomodoroTheme.background)
            .preferredColorScheme(.light)
    }
}
