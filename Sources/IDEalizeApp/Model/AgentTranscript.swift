import Foundation

/// One real user prompt and the agent's reply to it. `answer` is nil while the
/// agent is still working (no assistant text has followed the prompt yet).
/// Shared vocabulary across every agent's transcript adapter — Claude's reader
/// aliases its old `ClaudeTranscript.Exchange` to this.
struct AgentExchange: Equatable, Identifiable {
    let index: Int
    let question: String
    let answer: String?
    var id: Int { index }
}

/// The newest turn's context usage: the tokens the conversation is carrying,
/// paired with the window the model allows. Drives the per-chat context gauge.
struct AgentContextUsage: Equatable {
    let tokens: Int
    let limit: Int
    var fraction: Double { min(1, Double(tokens) / Double(limit)) }
}

/// One live pane's view onto its agent's on-disk transcript. A reader is bound
/// to a single session (cwd + launch) and encapsulates that agent's way of
/// locating "my transcript" — Claude's bound-vs-newest-vs-stillborn dance,
/// Kimi's post-launch session-dir discovery — so `TerminalSession` stays
/// agent-agnostic.
protocol AgentTranscriptReader: AnyObject {
    /// Locate (or re-locate) the transcript file. nil = not written / not
    /// identifiable yet; the caller waits rather than grabbing another
    /// session's file.
    func currentTranscriptURL() -> URL?

    /// Every Q&A turn in the transcript, oldest→newest.
    func allExchanges(in url: URL) -> [AgentExchange]

    /// The latest turn's context usage, or nil when none has been written.
    func contextUsage(in url: URL) -> AgentContextUsage?

    /// Working/idle inferred from the transcript tail. nil = this adapter
    /// can't tell (Claude — its working state comes from on-screen markers).
    func isGenerating(in url: URL) -> Bool?

    /// The id that lets an archived chat resume this conversation later
    /// (Claude: the jsonl basename; Kimi: the `session_*` dir basename).
    /// nil until known.
    var sessionId: String? { get }

    /// The first chat message submitted to this session — some adapters
    /// (Kimi) use it as a nonce to confirm which on-disk session is theirs.
    func noteSubmitted(_ text: String)
}

extension AgentTranscriptReader {
    func isGenerating(in url: URL) -> Bool? { nil }
    func noteSubmitted(_ text: String) {}
}

/// Claude Code's reader: a thin stateful wrapper over the `ClaudeTranscript`
/// statics. Holds the launched `--session-id` binding and the stillborn
/// fallback that used to live inline in `TerminalSession.refreshAssistantMessage`.
final class ClaudeTranscriptReader: AgentTranscriptReader {
    private let cwd: String
    /// The session id we launched Claude with (`claude --session-id <uuid>`), so
    /// we read exactly this terminal's transcript rather than the newest file in
    /// the project dir. nil when Claude was started by hand.
    private let boundSessionId: String?
    /// The transcript last handed out — its basename is the resumable id.
    private var lastURL: URL?

    init(cwd: String, boundSessionId: String?) {
        self.cwd = cwd
        self.boundSessionId = boundSessionId
    }

    var sessionId: String? { lastURL?.deletingPathExtension().lastPathComponent }

    func currentTranscriptURL() -> URL? {
        // Prefer the transcript for the session we launched (so a Claude running
        // elsewhere in the same folder can't bleed in); fall back to newest only
        // when Claude was started by hand and we never bound a session id.
        let url: URL
        if let id = boundSessionId, let bound = ClaudeTranscript.transcript(forCwd: cwd, sessionId: id) {
            // Normally read exactly the session we launched. But the auto-launch
            // can go stillborn (Claude writes a few init lines under our
            // --session-id, then the user's real conversation ends up under a
            // different id). When the bound transcript holds no real exchange yet
            // a strictly-newer transcript exists in the same folder, the user is
            // really talking to that one — follow it, or the chat reads the empty
            // bound file forever. A live parallel-tab Claude has real content, so
            // this still won't bleed it in.
            if let newest = ClaudeTranscript.newestTranscript(forCwd: cwd),
               newest != bound,
               ClaudeTranscript.modDate(newest) > ClaudeTranscript.modDate(bound),
               transcriptIsStillborn(bound) {
                url = newest
            } else {
                url = bound
            }
        } else if boundSessionId == nil, let newest = ClaudeTranscript.newestTranscript(forCwd: cwd) {
            url = newest
        } else {
            return nil   // bound session's file not written yet — wait, don't grab another
        }
        lastURL = url
        return url
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        ClaudeTranscript.allExchanges(in: url)
    }

    func contextUsage(in url: URL) -> AgentContextUsage? {
        ClaudeTranscript.contextUsage(in: url)
    }

    /// A transcript with no real prompt or answer — e.g. a `--session-id` launch
    /// that wrote a few init lines, then never carried a conversation.
    private func transcriptIsStillborn(_ url: URL) -> Bool {
        let e = ClaudeTranscript.lastExchange(in: url)
        return e.question == nil && e.answer == nil
    }
}
