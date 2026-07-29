import SwiftUI
import AppKit

/// Opens the standard SwiftUI `Settings` scene programmatically (there's no public
/// API for it, so we send the AppKit action). Used by the Service hatch when it
/// can't find IDEalize's source and needs the user to point at it.
enum SettingsWindow {
    static func open() {
        NSApp.activate(ignoringOtherApps: true)
        // macOS 14+ renamed the selector from `showPreferencesWindow:`.
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }
}

/// Preferences window: default launch behavior, notifications, sound. (All
/// appearance controls live in the in-view Appearance panel — ⌘⌥A.)
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
            Section("Service hatch") {
                HStack {
                    Text(sourceFolderLabel)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(settings.serviceHatchRepoPath.isEmpty ? .secondary : .primary)
                        .lineLimit(1).truncationMode(.head)
                    Spacer()
                    if !settings.serviceHatchRepoPath.isEmpty {
                        Button("Clear") { settings.serviceHatchRepoPath = "" }
                    }
                    Button("Choose…") { chooseSourceFolder() }
                }
                if !settings.serviceHatchRepoPath.isEmpty,
                   !ServiceHatch.isRepo(settings.serviceHatchRepoPath) {
                    Label("This folder doesn't look like an IDEalize checkout.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                Text("The wrench-icon service hatch opens an agent session on IDEalize's own code. Point this at your IDEalize source folder so it knows where that code lives.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var sourceFolderLabel: String {
        settings.serviceHatchRepoPath.isEmpty
            ? "No source folder chosen"
            : (settings.serviceHatchRepoPath as NSString).abbreviatingWithTildeInPath
    }

    /// Folder picker for the IDEalize source checkout — friendlier than typing a
    /// path. Warns (but still saves) if the pick isn't a valid checkout, so the
    /// mistake is visible rather than a silent no-op later at the wrench button.
    private func chooseSourceFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use as source"
        panel.message = "Choose your IDEalize source folder (the one containing Package.swift)."
        if panel.runModal() == .OK, let url = panel.url {
            settings.serviceHatchRepoPath = url.path
        }
    }

    private var behaviorTab: some View {
        Form {
            Section("Notifications") {
                Toggle("Enable notifications (idealize notify)", isOn: $settings.notificationsEnabled)
                Text("Your agent can raise notifications with `idealize notify \"text\"`.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Sound") {
                Toggle("Task-complete chime", isOn: $settings.completionSoundEnabled)
                HStack {
                    Text("Volume")
                    Slider(value: $settings.completionSoundVolume, in: 0...1, step: 0.05)
                    Button("Preview") { DoneSound.preview() }
                }
                .disabled(!settings.completionSoundEnabled)
                Text("Plays a gentle shine when Claude finishes a task.")
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

