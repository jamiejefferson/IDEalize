import Foundation

/// Which file the explorer is highlighting, and the standing request to reveal one.
///
/// Deliberately *not* stored on `Workspace` or `AppSettings`: nearly every view
/// observes those, so a reveal would re-render the whole app. Only file rows and
/// the explorer watch this, the same split `PanelLayout` makes for panel geometry.
final class FileReveal: ObservableObject {
    static let shared = FileReveal()

    /// A reveal asked for by an agent (or by the user clicking a file).
    ///
    /// Carries a `token` so two consecutive reveals of the *same* file still read
    /// as distinct requests — otherwise re-revealing a file the user has scrolled
    /// away from would be a no-op.
    struct Request: Equatable {
        let url: URL
        let open: Bool
        let token: Int
    }

    /// The file to draw as selected.
    @Published var selected: URL?
    /// The latest reveal. Left in place rather than consumed: focusing another
    /// session rebuilds the explorer, and the fresh view applies this on appear.
    @Published private(set) var request: Request?

    private var token = 0
    private var claimedToken = 0

    /// Ask the explorer to expand down to `url`, scroll it into view and select it.
    func reveal(_ url: URL, open: Bool = false) {
        token += 1
        let target = url.standardizedFileURL
        selected = target
        request = Request(url: target, open: open, token: token)
    }

    /// Act on `request` exactly once.
    ///
    /// Revealing a file in another project focuses that project's terminal, which
    /// rebuilds the explorer — so the outgoing tree and the incoming one both see
    /// the request, and a tab switch later would replay it. Whichever tree
    /// actually contains the file claims it; everyone else is told no. Not
    /// `@Published`: claiming must not re-render anything.
    func claim(_ request: Request) -> Bool {
        guard request.token > claimedToken else { return false }
        claimedToken = request.token
        return true
    }

    /// Record a selection the user made directly, without scrolling anything.
    func select(_ url: URL) {
        selected = url.standardizedFileURL
    }
}
