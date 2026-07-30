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
    /// Legacy (pre-0.5) agent flag — kept so old snapshots decode and old app
    /// versions reading a new snapshot still restore Claude chats. Read via
    /// `effectiveAgentBinary`, never directly.
    var wasClaude: Bool
    /// The agent this chat ran (adapter `binaryName`), so restore relaunches
    /// the same agent. nil = plain shell (or a legacy record; see below).
    var agentBinary: String?

    /// The agent to restore, honouring legacy records that only knew "Claude".
    var effectiveAgentBinary: String? { agentBinary ?? (wasClaude ? "claude" : nil) }

    /// Whether this chat was the project's coordinating agent, so restore brings
    /// it back *as* one — relaunched with the `/project-agent` guide and watched
    /// by a fresh `ProjectMonitor` — rather than as an ordinary Claude chat.
    /// Decoded with `decodeIfPresent` so snapshots written before this existed
    /// still decode (a property default alone is ignored by synthesized
    /// `Codable`); coordinators from those runs come back as plain chats, once.
    var isProjectAgent: Bool = false

    /// Whether this chat was the workspace's lead agent, so restore brings it
    /// back *as* one — relaunched with the `/lead-agent` guide in the Fleet
    /// folder. Same legacy-decode contract as `isProjectAgent`.
    var isLeadAgent: Bool = false

    init(customName: String?, wasClaude: Bool, agentBinary: String?,
         isProjectAgent: Bool = false, isLeadAgent: Bool = false) {
        self.customName = customName
        self.wasClaude = wasClaude
        self.agentBinary = agentBinary
        self.isProjectAgent = isProjectAgent
        self.isLeadAgent = isLeadAgent
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        customName = try c.decodeIfPresent(String.self, forKey: .customName)
        wasClaude = try c.decodeIfPresent(Bool.self, forKey: .wasClaude) ?? false
        agentBinary = try c.decodeIfPresent(String.self, forKey: .agentBinary)
        isProjectAgent = try c.decodeIfPresent(Bool.self, forKey: .isProjectAgent) ?? false
        isLeadAgent = try c.decodeIfPresent(Bool.self, forKey: .isLeadAgent) ?? false
    }
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
    /// Legacy (pre-0.5) agent flag — read via `effectiveAgentBinary`.
    var wasClaude: Bool
    /// The agent this chat ran (adapter `binaryName`); nil = plain shell or a
    /// legacy record.
    var agentBinary: String?
    /// The agent's session id, if known — lets reopening resume the conversation
    /// via the adapter's resume command.
    var sessionId: String?
    /// How many context tokens it was carrying when archived (shown in the list).
    var contextTokens: Int?
    /// The context window its model allowed (200k or 1M) — the denominator for the
    /// archived % readout. Nil for older records / non-Claude chats.
    var contextLimit: Int?
    /// When it was archived.
    var archivedAt: Date

    /// The agent to reopen with, honouring legacy records that only knew "Claude".
    var effectiveAgentBinary: String? { agentBinary ?? (wasClaude ? "claude" : nil) }
}
