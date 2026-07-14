import SwiftUI

/// Live geometry of the user-draggable panels: the three column widths and the
/// browse pane's height.
///
/// These deliberately live outside `AppSettings`. A drag rewrites the value on
/// every mouse event, and `AppSettings.shared` is observed by nearly every view
/// in the app — so publishing from there re-rendered the entire view tree (and
/// wrote to UserDefaults) a hundred times a second. Here only the two views that
/// actually lay panels out observe the change, and the values are persisted once,
/// when the drag ends.
///
/// The UserDefaults keys are unchanged, so widths saved by earlier builds load.
final class PanelLayout: ObservableObject {
    static let shared = PanelLayout()

    private let defaults = UserDefaults.standard

    @Published var railWidth: Double
    @Published var filesWidth: Double
    @Published var viewerWidth: Double
    @Published var browserHeight: Double

    private init() {
        railWidth = defaults.object(forKey: "railWidth") as? Double ?? 182
        filesWidth = defaults.object(forKey: "filesWidth") as? Double ?? 194
        viewerWidth = defaults.object(forKey: "viewerWidth") as? Double ?? 400
        browserHeight = defaults.object(forKey: "browserHeight") as? Double ?? 220
    }

    /// Write the geometry through to UserDefaults. Called once at the end of a
    /// drag rather than on every frame of it.
    func persist() {
        defaults.set(railWidth, forKey: "railWidth")
        defaults.set(filesWidth, forKey: "filesWidth")
        defaults.set(viewerWidth, forKey: "viewerWidth")
        defaults.set(browserHeight, forKey: "browserHeight")
    }
}
