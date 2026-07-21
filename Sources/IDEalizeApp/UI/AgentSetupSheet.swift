import SwiftUI

/// First-run handshake for an agent IDEalize doesn't recognise. Captures the
/// integration details the chat UI needs and saves them as a reusable profile.
struct AgentSetupSheet: View {
    let binary: String
    let onSave: (AgentProfile) -> Void
    let onSkip: () -> Void

    @State private var name: String
    @State private var transcriptPathTemplate: String = ""
    @State private var transcriptFormat: AgentProfile.TranscriptFormat = .none
    @State private var promptStyle: AgentProfile.PromptStyle = .numberedList
    @State private var workingPatterns: String = "esc to interrupt, esc to cancel"
    @State private var modelSwitchCommand: String = ""
    @State private var slashCommands: String = ""
    @State private var effortKeywords: String = ""

    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    init(binary: String, onSave: @escaping (AgentProfile) -> Void, onSkip: @escaping () -> Void) {
        self.binary = binary
        self.onSave = onSave
        self.onSkip = onSkip
        _name = State(initialValue: binary.capitalized)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "hand.wave.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(settings.actionStyle.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Set up \(binary)")
                        .font(settings.ui(16, .semibold))
                        .foregroundStyle(Color(theme.foreground))
                    Text("IDEalize doesn't know this agent yet. Tell it how to read its transcripts and prompts.")
                        .font(settings.ui(12))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Form {
                Section("Identity") {
                    TextField("Display name", text: $name)
                }

                Section("Transcript") {
                    Picker("Format", selection: $transcriptFormat) {
                        ForEach(AgentProfile.TranscriptFormat.allCases, id: \.self) {
                            Text($0.rawValue).tag($0)
                        }
                    }
                    TextField("Path template (use {workdir} and {session})", text: $transcriptPathTemplate)
                        .font(.system(.body, design: .monospaced))
                        .disabled(transcriptFormat == .none)
                }

                Section("Prompts") {
                    Picker("Prompt style", selection: $promptStyle) {
                        ForEach(AgentProfile.PromptStyle.allCases, id: \.self) {
                            Text($0.rawValue).tag($0)
                        }
                    }
                    TextField("Working-status keywords (comma-separated)", text: $workingPatterns)
                }

                Section("Commands") {
                    TextField("Model switch command (optional)", text: $modelSwitchCommand)
                    TextField("Slash commands (comma-separated, optional)", text: $slashCommands)
                    TextField("Effort keywords: Label=keyword, one per line (optional)", text: $effortKeywords)
                        .lineLimit(3)
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Skip for now", action: onSkip)
                    .foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                Button("Save profile") { save() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 520, height: 560)
        .background(Color(theme.chrome))
    }

    private func save() {
        let keywords = effortKeywords
            .split(separator: "\n")
            .compactMap { line -> (String, String)? in
                let parts = line.split(separator: "=", maxSplits: 1)
                guard parts.count == 2 else { return nil }
                return (String(parts[0]).trimmingCharacters(in: .whitespaces),
                        String(parts[1]).trimmingCharacters(in: .whitespaces))
            }
        let profile = AgentProfile(
            name: name.trimmingCharacters(in: .whitespaces),
            binaryName: binary,
            transcriptPathTemplate: transcriptPathTemplate.trimmingCharacters(in: .whitespaces),
            transcriptFormat: transcriptFormat,
            promptStyle: promptStyle,
            workingLinePatterns: workingPatterns
                .split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty },
            modelSwitchCommand: modelSwitchCommand.trimmingCharacters(in: .whitespaces).isEmpty
                ? nil : modelSwitchCommand.trimmingCharacters(in: .whitespaces),
            effortKeywords: Dictionary(uniqueKeysWithValues: keywords),
            slashCommands: slashCommands
                .split(separator: ",")
                .map { String($0).trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        )
        onSave(profile)
    }
}
