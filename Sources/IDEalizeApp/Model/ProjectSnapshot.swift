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
    /// Legacy "this was a Claude session" flag. Still ENCODED (as
    /// `agentId == "claude"`) so an older app build reading the same defaults
    /// keeps restoring correctly; superseded by `agentId` for reading.
    var wasClaude: Bool
    /// Which agent this chat ran ("claude", "kimi", …) so restore relaunches
    /// the same one. nil on records written before multi-agent support.
    var agentId: String?

    /// The agent to restore: the recorded id, or Claude for legacy records.
    var effectiveAgentId: String? { agentId ?? (wasClaude ? "claude" : nil) }
}

struct PersistedProject: Codable {
    /// The project folder path — the grouping key.
    var path: String
    /// The chats open under this project, in order.
    var chats: [PersistedChat]
}

// Collapse state persists separately (AppSettings.collapsedProjects), keyed by
// project path, and is pruned to live projects on each save.

/// A chat the user archived: its terminal is closed and freed, but this
/// lightweight record survives so the chat can be reviewed — and reopened
/// (resuming its Claude conversation) — later from the Archived Chats list.
/// Stored in `AppSettings.archivedChats`, deliberately separate from
/// `projectSnapshot` so archiving never disturbs restore-on-launch of live chats.
struct ArchivedChat: Codable, Identifiable {
    var id: UUID = UUID()
    /// The project folder the chat belonged to (its grouping key).
    var projectPath: String
    /// The chat's display name at archive time (its custom name, or "Chat N").
    var name: String
    /// Legacy "was a Claude session" flag — still encoded for older builds;
    /// superseded by `agentId` for reading (see `effectiveAgentId`).
    var wasClaude: Bool
    /// Which agent the chat ran ("claude", "kimi", …) so reopening relaunches
    /// the same one. nil on records written before multi-agent support.
    var agentId: String?
    /// The agent's session id, if known — lets reopening resume the
    /// conversation (Claude: transcript basename; Kimi: `session_*` dir name).
    var sessionId: String?
    /// How many context tokens it was carrying when archived (shown in the list).
    var contextTokens: Int?
    /// The context window its model allowed (200k or 1M) — the denominator for the
    /// archived % readout. Nil for older records / non-Claude chats.
    var contextLimit: Int?
    /// When it was archived.
    var archivedAt: Date

    /// The agent to reopen with: the recorded id, or Claude for legacy records.
    var effectiveAgentId: String? { agentId ?? (wasClaude ? "claude" : nil) }
}
