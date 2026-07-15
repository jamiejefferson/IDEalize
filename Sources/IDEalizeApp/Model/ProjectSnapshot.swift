import Foundation

/// A lightweight, `Codable` snapshot of the session rail, persisted to
/// UserDefaults so Projects and their Chats can be restored on the next launch.
///
/// Live sessions are process-backed and not themselves `Codable`; this records
/// only what's needed to rebuild the rail: which project folders were open, the
/// chats inside each, and their names. The Shared Project Note is *not* stored
/// here — it lives durably as a file inside the project folder.
struct PersistedChat: Codable {
    /// The user's custom tab name, if they renamed it.
    var customName: String?
    /// Whether this chat was a Claude session (so it relaunches Claude on
    /// restore, rather than coming up as a bare shell).
    var wasClaude: Bool
}

struct PersistedProject: Codable {
    /// The project folder path — the grouping key.
    var path: String
    /// The chats open under this project, in order.
    var chats: [PersistedChat]
}

// Collapse state persists separately (AppSettings.collapsedProjects), keyed by
// project path, and is pruned to live projects on each save.
