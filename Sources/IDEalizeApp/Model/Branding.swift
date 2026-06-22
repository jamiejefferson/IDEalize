import AppKit

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
