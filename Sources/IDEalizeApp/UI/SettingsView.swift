import SwiftUI

/// Preferences window: default launch behavior, notifications. (All appearance
/// controls now live in the in-view Appearance panel — ⌘⌥A.)
struct SettingsView: View {
    @ObservedObject var settings = AppSettings.shared

    var body: some View {
        TabView {
            launchTab
                .tabItem { Label("Launch", systemImage: "play.circle") }
            WorkflowsSettings()
                .tabItem { Label("Workflows", systemImage: "wand.and.stars") }
            behaviorTab
                .tabItem { Label("Behavior", systemImage: "gearshape") }
        }
        .frame(width: 540, height: 420)
        .padding()
    }

    private var launchTab: some View {
        Form {
            Section("Default launch command") {
                Toggle("Run a command automatically in new terminals", isOn: $settings.launchOnNewTerminal)
                TextField("Command", text: $settings.defaultLaunchCommand)
                    .font(.system(.body, design: .monospaced))
                    .disabled(!settings.launchOnNewTerminal)
                Text("e.g. claude --dangerously-skip-permissions")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Shell") {
                TextField("Login shell", text: $settings.shellPath)
                    .font(.system(.body, design: .monospaced))
            }
        }
        .formStyle(.grouped)
    }

    private var behaviorTab: some View {
        Form {
            Section("Notifications") {
                Toggle("Enable notifications (idealize notify)", isOn: $settings.notificationsEnabled)
                Text("Claude Code can raise notifications with `idealize notify \"text\"`.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Local terminal control") {
                Toggle("Allow same-user local IPC terminal control",
                       isOn: $settings.allowCrossSessionControl)
                Text("When enabled, local IPC clients running as your macOS user can type or run commands in IDEalize terminals using `idealize type` and `idealize exec`. Session IDs are routing hints, not authentication.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}
