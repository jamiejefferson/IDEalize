import Foundation

// MARK: - Shared value types

/// One real user prompt and the agent's reply to it. `answer` is nil while the
/// agent is still working (no assistant text has followed the prompt yet).
struct AgentExchange: Equatable, Identifiable {
    let index: Int
    let question: String
    let answer: String?
    var id: Int { index }
}

/// A confirmation / choice prompt an agent is showing in the terminal,
/// reconstructed from the visible screen so we can answer it from the chat UI.
struct AgentPrompt: Equatable {
    var question: String
    var options: [Option]

    /// True when any option carries a checkbox — i.e. the agent is showing a
    /// multi-select that needs toggling + a confirm (Enter), not a single pick.
    var isMultiSelect: Bool { options.contains { $0.checkState != .none } }

    struct Option: Equatable, Identifiable {
        var id: Int { number }
        let number: Int
        let label: String          // clean label (checkbox marker stripped)
        var checkState: CheckState = .none

        enum CheckState { case none, unchecked, checked }
    }
}

/// The agent's working state lifted from the visible terminal screen.
struct AgentWorkingState: Equatable {
    let isWorking: Bool
    let status: String?      // e.g. "17m 43s · ↑ 31.9k tokens"
    let tip: String?         // e.g. "Use /btw to ask a quick side question…"
}

// MARK: - Adapter protocol

/// A bridge between IDEalize and an agent CLI running in a terminal.
protocol AgentAdapter {
    /// Human-readable agent name for UI copy.
    var name: String { get }
    /// The command/binary name used to detect this agent (e.g. "claude", "kimi").
    var binaryName: String { get }

    /// True when the given foreground command is this agent.
    func matches(command: String) -> Bool

    /// Locate the agent's transcript for a working directory. `sessionId` is the
    /// id IDEalize bound at launch (when supported); nil when the agent was
    /// started by hand.
    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL?

    /// Parse every Q&A exchange from a transcript file, oldest → newest.
    func allExchanges(in url: URL) -> [AgentExchange]

    /// The latest exchange, if any.
    func lastExchange(in url: URL) -> AgentExchange?

    /// Reconstruct an interactive choice prompt from visible terminal lines.
    func parsePrompt(lines: [String]) -> AgentPrompt?

    /// Lift the agent's working state (spinner/status/tip) from visible lines.
    func detectWorkingState(lines: [String]) -> AgentWorkingState

    /// Whether the agent supports switching model at runtime (e.g. `/model`).
    var supportsRuntimeModelSwitch: Bool { get }

    /// Whether the agent supports reasoning-effort keywords.
    var supportsReasoningEffort: Bool { get }

    /// Slash commands the adapter knows how to run (e.g. `/flow-review`).
    var supportedSlashCommands: [String] { get }

    /// Command used to switch model at runtime, if supported.
    var modelSwitchCommand: String? { get }

    /// Reasoning-effort keywords this agent understands.
    var effortKeywords: [String: String] { get }
}

// MARK: - Agent registry

enum AgentRegistry {
    /// All registered adapters, most specific first.
    static var adapters: [AgentAdapter] {
        var list: [AgentAdapter] = [ClaudeAgentAdapter(), KimiAgentAdapter()]
        list.append(contentsOf: AgentProfileStore.shared.customAdapters())
        list.append(GenericAgentAdapter())
        return list
    }

    /// The adapter matching a foreground command, if any.
    static func adapter(forCommand command: String) -> AgentAdapter? {
        adapters.first { $0.matches(command: command) }
    }
}

// MARK: - Generic fallback

/// A screen-only adapter for agents IDEalize doesn't know yet. It provides
/// basic prompt detection and working status, but no transcript history.
struct GenericAgentAdapter: AgentAdapter {
    let name = "Agent"
    let binaryName = ""

    func matches(command: String) -> Bool { false }   // only used as fallback

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? { nil }
    func allExchanges(in url: URL) -> [AgentExchange] { [] }
    func lastExchange(in url: URL) -> AgentExchange? { nil }

    func parsePrompt(lines: [String]) -> AgentPrompt? {
        AgentPromptParser.parse(lines)
    }

    func detectWorkingState(lines: [String]) -> AgentWorkingState {
        AgentWorkingState(isWorking: false, status: nil, tip: nil)
    }

    var supportsRuntimeModelSwitch: Bool { false }
    var supportsReasoningEffort: Bool { false }
    var supportedSlashCommands: [String] { [] }
    var modelSwitchCommand: String? { nil }
    var effortKeywords: [String: String] { [:] }
}
