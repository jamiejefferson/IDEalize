// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "IDEalize",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "IDEalize", targets: ["IDEalizeApp"]),
        // NOTE: must NOT be "idealize" — macOS filesystems are case-insensitive,
        // so an "idealize" binary would collide with "IDEalize" in the build dir.
        // It is installed under the user-facing name `idealize` via a shim symlink.
        .executable(name: "idealize-cli", targets: ["idealizeCLI"]),
        .library(name: "IDEalizeCore", targets: ["IDEalizeCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0"),
        // Local, on-device speech-to-text (Parakeet/CoreML on the Neural Engine)
        // for meeting transcription in the document panel. No audio leaves the Mac.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4"),
    ],
    targets: [
        // Shared IPC protocol + socket helpers used by both the app and the CLI.
        .target(
            name: "IDEalizeCore",
            dependencies: [],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // The macOS GUI application.
        .executableTarget(
            name: "IDEalizeApp",
            dependencies: [
                "IDEalizeCore",
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "FluidAudio", package: "FluidAudio"),
            ],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // The `idealize` command-line helper invoked by Claude Code / pi from inside a terminal.
        .executableTarget(
            name: "idealizeCLI",
            dependencies: ["IDEalizeCore"],
            path: "Sources/idealizeCLI",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "IDEalizeCoreTests",
            dependencies: ["IDEalizeCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
