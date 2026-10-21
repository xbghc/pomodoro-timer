import XCTest
@testable import PomodoroCore

final class DrawerGeometryTests: XCTestCase {
    func screen(_ id: Int, _ x: Double, _ y: Double, _ width: Double = 1440, _ height: Double = 900) -> DesktopScreen {
        DesktopScreen(id: id, frame: CGRect(x: x, y: y, width: width, height: height),
                      visibleFrame: CGRect(x: x, y: y + 40, width: width, height: height - 65))
    }

    func testCollapsedWindowDoesNotKeepInvisibleExpandedHitArea() {
        let screen = screen(1, 0, 0)
        let collapsed = DrawerGeometry.frame(on: screen, expanded: false)
        let expanded = DrawerGeometry.frame(on: screen, expanded: true)
        XCTAssertEqual(collapsed.width, 12)
        XCTAssertEqual(collapsed.height, 92)
        XCTAssertEqual(collapsed.maxX, screen.frame.maxX)
        XCTAssertEqual(expanded.maxX, screen.frame.maxX)
        XCTAssertTrue(expanded.contains(collapsed))
        XCTAssertFalse(collapsed.contains(CGPoint(x: expanded.minX + 1, y: expanded.midY)))
    }

    func testSideBySideUsesOuterScreenAndHandlesNegativeCoordinates() {
        let screens = [screen(1, 0, 0), screen(2, 1440, 0), screen(3, -1440, 0)]
        XCTAssertEqual(DrawerGeometry.screen(in: screens, preferredID: 1)?.id, 2)
        XCTAssertEqual(DrawerGeometry.screen(in: screens, preferredID: 3)?.id, 2)
        XCTAssertEqual(DrawerGeometry.screen(in: screens, preferredID: 99)?.id, 2)
    }

    func testVerticallySeparatedMonitorDoesNotForceDrawerAway() {
        XCTAssertEqual(DrawerGeometry.screen(in: [screen(1, 0, 0), screen(2, 1440, 900)], preferredID: 1)?.id, 1)
        XCTAssertNil(DrawerGeometry.screen(in: [], preferredID: nil))
    }
}
