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
                Text("e.g. claude --dangerously-skip-permissions, kimi, or another agent CLI")
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
                Text("Your agent can raise notifications with `idealize notify \"text\"`.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Mini Mode") {
                Picker("Dock side", selection: $settings.miniModeDockSide) {
                    ForEach(DockSide.allCases) { side in
                        Text(side.displayName).tag(side)
                    }
                }
                Toggle("Keep window on top", isOn: $settings.miniModeAlwaysOnTop)
                Text("Mini-mode shrinks IDEalize to a narrow docked column so it stays beside your work on a single screen.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: settings.miniModeDockSide) { MiniModeManager.shared.refreshIfNeeded() }
        .onChange(of: settings.miniModeAlwaysOnTop) { MiniModeManager.shared.refreshIfNeeded() }
    }
}

