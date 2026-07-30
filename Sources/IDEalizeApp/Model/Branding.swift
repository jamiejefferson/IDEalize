import AppKit
import CoreText

/// Bundled fonts (Resources/Fonts). Registered at launch so NSFont / SwiftUI
/// can resolve them by family name (e.g. the default terminal face "DM Mono").
enum Fonts {
    static func registerBundled() {
        let dirs = [
            Bundle.main.resourceURL?.appendingPathComponent("Fonts"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath + "/Resources/Fonts"),
        ].compactMap { $0 }
        for dir in dirs {
            let fonts = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
                .filter { ["ttf", "otf"].contains($0.pathExtension.lowercased()) } ?? []
            guard !fonts.isEmpty else { continue }
            for url in fonts { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
            return
        }
    }
}

/// The IDEalize owl — the welcome mascot shown on the empty "What shall we make?"
/// slate. A run-cycle of transparent PNG frames (Resources/Owl/owl_NN.png),
/// cycled like the working critters.
enum Owl {
    private static var cache: [NSImage]?

    static func frames() -> [NSImage] {
        if let c = cache { return c }
        var out: [NSImage] = []
        var i = 0
        while let img = load(String(format: "Owl/owl_%02d.png", i)) { out.append(img); i += 1 }
        cache = out
        return out
    }

    private static func load(_ relativePath: String) -> NSImage? {
        if let url = Bundle.main.resourceURL?.appendingPathComponent(relativePath),
           let image = NSImage(contentsOf: url) {
            return image
        }
        return NSImage(contentsOfFile: FileManager.default.currentDirectoryPath + "/Resources/" + relativePath)
    }
}

/// App identity assets (the IDEalize wordmark logo).
enum Branding {
    /// The wordmark logo, loaded from the app bundle (or the dev Resources dir).
    static let logo: NSImage? = {
        if let url = Bundle.main.resourceURL?.appendingPathComponent("IDEalizeLogo.png"),
           let image = NSImage(contentsOf: url) {
            return image
        }
        let dev = FileManager.default.currentDirectoryPath + "/Resources/IDEalizeLogo.png"
        return NSImage(contentsOfFile: dev)
    }()
}

/// The little running animals shown in the chat while Claude is working. One is
/// picked per task (see `WorkingCritter`), from full-colour cutout PNGs bundled
/// under Resources/Critters.
enum Critters {
    /// The available critters, in a fixed order so a task's seed maps stably.
    static let names = ["fox", "cat", "bunny", "dog", "duck", "hedgehog"]

    private static var frameCache: [String: [NSImage]] = [:]

    /// The critter for a given per-task seed (e.g. the turn count).
    static func name(forSeed seed: Int) -> String {
        names[abs(seed) % names.count]
    }

    /// The run-cycle frames for a critter — `critter_<name>_1.png`, `_2.png`, …
    /// in order. Falls back to the single still `critter_<name>.png` (as a
    /// one-frame array) when no numbered frames are bundled. Cached after first
    /// load so the working animation doesn't hit disk each frame.
    static func frames(_ name: String) -> [NSImage] {
        if let cached = frameCache[name] { return cached }
        var out: [NSImage] = []
        for i in 1...8 {
            if let img = load("Critters/critter_\(name)_\(i).png") { out.append(img) } else { break }
        }
        if out.isEmpty, let single = load("Critters/critter_\(name).png") { out = [single] }
        frameCache[name] = out
        return out
    }

    /// Load a bundled resource image, falling back to the dev Resources dir.
    private static func load(_ relativePath: String) -> NSImage? {
        if let url = Bundle.main.resourceURL?.appendingPathComponent(relativePath),
           let image = NSImage(contentsOf: url) {
            return image
        }
        let dev = FileManager.default.currentDirectoryPath + "/Resources/" + relativePath
        return NSImage(contentsOfFile: dev)
    }
}
