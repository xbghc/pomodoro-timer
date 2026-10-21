// swift-tools-version: 6.0
import PackageDescription

var products: [Product] = [.library(name: "PomodoroCore", targets: ["PomodoroCore"])]
var targets: [Target] = [
    .target(name: "PomodoroCore"),
    .testTarget(name: "PomodoroCoreTests", dependencies: ["PomodoroCore"])
]
#if os(macOS)
products.append(.executable(name: "PomodoroTimer", targets: ["PomodoroApp"]))
targets.append(.executableTarget(name: "PomodoroApp", dependencies: ["PomodoroCore"]))
#endif

let package = Package(
    name: "PomodoroTimer",
    platforms: [.macOS(.v13)],
    products: products,
    targets: targets,
    swiftLanguageModes: [.v6]
)
