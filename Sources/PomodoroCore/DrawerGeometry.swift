import Foundation

public struct DesktopScreen: Equatable {
    public let id: Int
    public let frame: CGRect
    public let visibleFrame: CGRect
    public init(id: Int, frame: CGRect, visibleFrame: CGRect) {
        self.id = id; self.frame = frame; self.visibleFrame = visibleFrame
    }
}

/// Coordinates use AppKit's bottom-left origin. The collapsed *window* is small, not merely its content.
public enum DrawerGeometry {
    public static let expandedSize = CGSize(width: 348, height: 304)
    public static let collapsedSize = CGSize(width: 12, height: 92)

    public static func screen(in screens: [DesktopScreen], preferredID: Int?) -> DesktopScreen? {
        guard let preferred = screens.first(where: { $0.id == preferredID }) ?? screens.first else { return nil }
        func hasOuterEdge(_ screen: DesktopScreen) -> Bool {
            let bottom = screen.visibleFrame.minY + 24
            return !screens.contains { other in
                other.id != screen.id && other.frame.minX > screen.frame.minX &&
                other.frame.minY < bottom + expandedSize.height && other.frame.maxY > bottom
            }
        }
        if hasOuterEdge(preferred) { return preferred }
        return screens.filter(hasOuterEdge).max(by: { $0.frame.maxX < $1.frame.maxX }) ?? preferred
    }

    public static func frame(on screen: DesktopScreen, expanded: Bool) -> CGRect {
        let desired = expanded ? expandedSize : collapsedSize
        let size = CGSize(width: min(desired.width, screen.frame.width),
                          height: min(desired.height, max(1, screen.visibleFrame.height - 48)))
        return CGRect(x: screen.frame.maxX - size.width,
                      y: screen.visibleFrame.minY + 24, width: size.width, height: size.height)
    }
}
