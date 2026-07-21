import Foundation

/// A user-configurable profile for an agent IDEalize doesn't know out of the box.
/// Saved profiles let the chat UI adapt to custom or new agent CLIs without code
/// changes.
struct AgentProfile: Codable, Equatable, Identifiable {
    var id: String { binaryName.lowercased() }
    var name: String
    var binaryName: String
    /// Template for the transcript path. Supports {workdir} and {session}.
    var transcriptPathTemplate: String
    var transcriptFormat: TranscriptFormat
    var promptStyle: PromptStyle
    /// Regex or keywords that indicate the agent is working.
    var workingLinePatterns: [String]
    /// Optional command to switch model at runtime (e.g. "/model").
    var modelSwitchCommand: String?
    /// Reasoning-effort keywords this agent understands.
    var effortKeywords: [String: String]
    /// Slash commands the agent supports.
    var slashCommands: [String]

    enum TranscriptFormat: String, Codable, CaseIterable {
        case claudeJSONL
        case kimiWireJSONL
        case none
    }

    enum PromptStyle: String, Codable, CaseIterable {
        case numberedList
        case arrowMenu
        case freeForm
    }
}

/// A built-in default profile used as a starting point when the user configures
/// an unknown agent.
extension AgentProfile {
    static func defaultProfile(binary: String) -> AgentProfile {
        AgentProfile(
            name: binary.capitalized,
            binaryName: binary,
            transcriptPathTemplate: "",
            transcriptFormat: .none,
            promptStyle: .numberedList,
            workingLinePatterns: ["esc to interrupt", "esc to cancel"],
            modelSwitchCommand: nil,
            effortKeywords: [:],
            slashCommands: []
        )
    }
}
