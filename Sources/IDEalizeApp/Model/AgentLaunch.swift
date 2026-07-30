import Foundation

/// How to start an agent in a terminal: the command and its flags, kept strictly
/// apart from the opening turn handed to the agent as a positional argument.
///
/// The separation is the point. The launch used to be assembled into one string
/// with the opening turn already quoted inside it, and `TerminalSession` then
/// pattern-matched and rewrote that whole string to add a session id and apply the
/// permission mode. So the rewriting read the *user's prose*:
///
/// - a brief mentioning `--permission-mode` had it stripped out mid-sentence;
/// - a brief containing ` -r ` looked like a session selector, so the chat was
///   never bound to its own transcript and followed a sibling's instead;
/// - a whitespace tidy-up flattened the indentation of a multi-line brief;
/// - a brief that merely mentioned "claude" made a `kimi` launch look like Claude,
///   so Claude-only flags were bolted on and it failed to start.
///
/// Keeping the turn out of the string until every rewrite has run makes all four
/// impossible by construction rather than by careful parsing.
struct AgentLaunch {
    /// The command and its flags — the only part that is ever rewritten.
    var command: String
    /// The agent's first prompt, or a slash command like `/project-agent`.
    /// Unquoted: quoting happens once, at the very end of augmentation.
    var openingTurn: String?

    init(command: String, openingTurn: String? = nil) {
        self.command = command
        self.openingTurn = openingTurn
    }

    /// Single-quote a shell argument. Used for the opening turn and for flag
    /// values that may contain spaces.
    static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
