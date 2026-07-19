import Foundation

/// Loads, saves, and provides user-configured agent profiles.
final class AgentProfileStore: ObservableObject {
    static let shared = AgentProfileStore()

    @Published private(set) var profiles: [AgentProfile] = []

    private let defaults = UserDefaults.standard
    private let key = "customAgentProfiles"

    private init() {
        load()
    }

    /// All custom adapters built from saved profiles.
    func customAdapters() -> [AgentAdapter] {
        profiles.map { CustomAgentAdapter(profile: $0) }
    }

    /// Save or update a profile (matched by binary name).
    func save(_ profile: AgentProfile) {
        if let i = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[i] = profile
        } else {
            profiles.append(profile)
        }
        persist()
    }

    func delete(_ profile: AgentProfile) {
        profiles.removeAll { $0.id == profile.id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(profiles) {
            defaults.set(data, forKey: key)
        }
    }

    private func load() {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([AgentProfile].self, from: data) else {
            profiles = []
            return
        }
        profiles = decoded
    }
}

/// An adapter driven by a user-configured `AgentProfile`.
struct CustomAgentAdapter: AgentAdapter {
    let profile: AgentProfile

    var name: String { profile.name }
    var binaryName: String { profile.binaryName }

    func matches(command: String) -> Bool {
        command.range(of: "(^|[ /&;])\(NSRegularExpression.escapedPattern(for: binaryName))($| )",
                      options: .regularExpression) != nil
    }

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? {
        guard profile.transcriptFormat != .none, !profile.transcriptPathTemplate.isEmpty else { return nil }
        var path = profile.transcriptPathTemplate
        path = path.replacingOccurrences(of: "{workdir}", with: ClaudeTranscript.encodedDir(for: cwd))
        path = path.replacingOccurrences(of: "{session}", with: sessionId ?? "")
        return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        switch profile.transcriptFormat {
        case .claudeJSONL:
            return ClaudeTranscript.allExchanges(in: url)
        case .kimiWireJSONL:
            return KimiTranscript.allExchanges(in: url)
        case .none:
            return []
        }
    }

    func lastExchange(in url: URL) -> AgentExchange? {
        switch profile.transcriptFormat {
        case .claudeJSONL:
            return ClaudeTranscript.lastExchange(in: url)
        case .kimiWireJSONL:
            return KimiTranscript.lastExchange(in: url)
        case .none:
            return nil
        }
    }

    func parsePrompt(lines: [String]) -> AgentPrompt? {
        switch profile.promptStyle {
        case .numberedList:
            return AgentPromptParser.parse(lines)
        case .arrowMenu, .freeForm:
            return nil
        }
    }

    func detectWorkingState(lines: [String]) -> AgentWorkingState {
        let working = lines.contains { line in
            let lower = line.lowercased()
            return profile.workingLinePatterns.contains { pattern in
                lower.contains(pattern.lowercased())
            }
        }
        return AgentWorkingState(isWorking: working, status: nil, tip: nil)
    }

    var supportsRuntimeModelSwitch: Bool { profile.modelSwitchCommand != nil }
    var supportsReasoningEffort: Bool { !profile.effortKeywords.isEmpty }
    var supportedSlashCommands: [String] { profile.slashCommands }
    var modelSwitchCommand: String? { profile.modelSwitchCommand }
    var effortKeywords: [String: String] { profile.effortKeywords }
}
