import Foundation

/// The model-agnostic interview session file. The UI writes this; the AI reads it
/// and writes the resulting flow to `flow.json`. No provider-specific APIs, no
/// extra authentication — any terminal AI that can read and write files can
/// participate.
struct FlowsSession: Codable, Equatable {
    /// The conversation so far, oldest first. The AI continues from the last turn.
    var turns: [InterviewTurn]
    /// The current interview state (e.g. "awaitingStageConfirmation").
    var state: String
    /// The outcome the user is trying to achieve, once captured.
    var outcome: String
    /// The success criteria, once captured.
    var successCriteria: String
    /// The stages confirmed so far.
    var stages: [FlowStage]
    /// The stage currently being proposed, if any.
    var pendingStage: FlowStage?

    /// The single global session path, beside `flow.json`.
    static func sessionURL(create: Bool) -> URL {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize")
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir.appendingPathComponent("flows-session.json")
    }

    /// Persist the session. Pretty-printed so the AI can read it easily.
    func write() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(self) else { return }
        try? data.write(to: Self.sessionURL(create: true))
    }

    /// Load the session, if one exists.
    static func load() -> FlowsSession? {
        let url = sessionURL(create: false)
        guard let data = try? Data(contentsOf: url),
              let session = try? JSONDecoder().decode(FlowsSession.self, from: data) else { return nil }
        return session
    }

    /// Remove the session file (e.g. when the interview is finished or reset).
    static func clear() {
        try? FileManager.default.removeItem(at: sessionURL(create: false))
    }
}

extension FlowsInterview {
    /// Snapshot the current interview as a `FlowsSession` for the AI to read.
    func sessionSnapshot() -> FlowsSession {
        FlowsSession(
            turns: turns,
            state: stateDescription,
            outcome: outcome,
            successCriteria: successCriteria,
            stages: stages,
            pendingStage: pendingStage
        )
    }

    /// Write the current interview state to disk so the terminal AI can read it.
    func exportSession() {
        sessionSnapshot().write()
    }
}
