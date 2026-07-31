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

/// Where the agent is in its sign-in / authentication flow, read off the
/// visible terminal. `.inProgress` covers the whole OAuth dance (method choice,
/// browser hand-off, paste-the-code, retry); `.succeeded` is the terminal's own
/// "logged in" confirmation. The chat echoes both so the OAuth flow — which
/// otherwise leaves the viewer blankly saying "ready" — is legible, and its
/// success (which the terminal only flashes before its welcome screen) is
/// clearly confirmed.
enum AgentLoginState: Equatable { case none, inProgress, succeeded }

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

    /// Detect the agent's sign-in / authentication state from visible lines.
    func detectLoginState(lines: [String]) -> AgentLoginState

    /// Whether the agent supports switching model at runtime (e.g. `/model`).
    var supportsRuntimeModelSwitch: Bool { get }

    /// Whether the agent supports reasoning-effort keywords.
    var supportsReasoningEffort: Bool { get }

    /// Whether the agent supports permission modes (plan / accept-edits / yolo),
    /// selected as a launch flag. Defaults to false; only Claude opts in.
    var supportsPermissionModes: Bool { get }

    /// Slash commands the adapter knows how to run (e.g. `/flow-review`).
    var supportedSlashCommands: [String] { get }

    /// Command used to switch model at runtime, if supported.
    var modelSwitchCommand: String? { get }

    /// Reasoning-effort keywords this agent understands.
    var effortKeywords: [String: String] { get }

    /// Lift the agent's own session id from the visible screen, for agents that
    /// print it (Kimi's welcome box shows "Session: session_…") but don't accept
    /// one at launch. Lets the chat panel follow exactly this terminal's session
    /// instead of guessing "newest in this directory". nil when not shown.
    func detectSessionId(lines: [String]) -> String?

    /// Command that launches this agent fresh, with IDEalize's preferred flags.
    /// nil when IDEalize shouldn't auto-launch it (screen-only adapters).
    var launchCommand: String? { get }

    /// Flag that hands the agent a fresh session id at launch (e.g.
    /// "--session-id"), so its transcript is identifiable. nil when the agent
    /// can't bind a session at launch (Kimi prints its id instead).
    var sessionIdLaunchFlag: String? { get }

    /// Flags meaning a launch command already picks its own session, so a fresh
    /// id must not be appended alongside them.
    var sessionSelectorFlags: [String] { get }

    /// Command that relaunches this agent resuming the given session, or nil
    /// when it can't resume by id. Drives "reopen archived chat".
    func resumeCommand(sessionId: String) -> String?

    /// The resumable session id encoded in a transcript file's location, if any
    /// (Claude: the file's basename; Kimi: the session directory's name).
    func sessionId(fromTranscriptURL url: URL) -> String?
}

extension AgentAdapter {
    /// Agents whose login flow IDEalize doesn't track never report one, so the
    /// chat treats them as always-signed-in (the common case once set up).
    func detectLoginState(lines: [String]) -> AgentLoginState { .none }

    /// Most agents don't expose permission modes; Claude overrides this.
    var supportsPermissionModes: Bool { false }

    /// Most agents can't switch model mid-session; Claude overrides this.
    var supportsRuntimeModelSwitch: Bool { false }
    var modelSwitchCommand: String? { nil }

    func detectSessionId(lines: [String]) -> String? { nil }
    var launchCommand: String? { nil }
    var sessionIdLaunchFlag: String? { nil }
    var sessionSelectorFlags: [String] { [] }
    func resumeCommand(sessionId: String) -> String? { nil }
    func sessionId(fromTranscriptURL url: URL) -> String? { nil }
}

// MARK: - Agent registry

enum AgentRegistry {
    /// All registered adapters, most specific first.
    static var adapters: [AgentAdapter] {
        var list: [AgentAdapter] = [ClaudeAgentAdapter(), PiAgentAdapter(), KimiAgentAdapter()]
        list.append(contentsOf: AgentProfileStore.shared.customAdapters())
        list.append(GenericAgentAdapter())
        return list
    }

    /// The adapter matching a foreground command, if any.
    static func adapter(forCommand command: String) -> AgentAdapter? {
        adapters.first { $0.matches(command: command) }
    }

    /// The adapter for a persisted agent `binaryName`, if still registered.
    static func adapter(forBinary binary: String?) -> AgentAdapter? {
        guard let binary, !binary.isEmpty else { return nil }
        return adapters.first { $0.binaryName == binary }
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

    var supportsReasoningEffort: Bool { false }
    var supportedSlashCommands: [String] { [] }
    var effortKeywords: [String: String] { [:] }
}
