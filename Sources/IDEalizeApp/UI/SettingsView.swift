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

/// Preferences window: default launch behavior, the project agent, notifications,
/// sound. (All appearance controls live in the in-view Appearance panel — ⌘⌥A.)
struct SettingsView: View {
    @ObservedObject var settings = AppSettings.shared

    /// Whether each model picker is sitting on "Custom…". Only needed for the case
    /// the stored string can't express: custom picked but nothing typed yet.
    @State private var coordinatorModelIsCustom = false
    @State private var childModelIsCustom = false
    @State private var leadModelIsCustom = false
    @State private var usesOwnLeadGuide = false
    @State private var ownLeadGuideIsBehind = false
    @State private var confirmingLeadGuideReset = false
    @State private var leadGuideResetFailed = false
    /// Snapshot of the coordinator's guide on disk, taken when the pane appears and
    /// after each button rather than on every redraw — a Form re-renders far more
    /// often than the file changes, and both of these hit the filesystem.
    @State private var usesOwnGuide = false
    @State private var ownGuideIsBehind = false
    /// Set when the built-in guide isn't on disk yet, so we can say so in place of
    /// opening an empty document.
    @State private var builtInGuideMissing = false
    @State private var confirmingGuideReset = false
    /// Set when a reset was asked for but the copy is still on disk afterwards, so
    /// we say so instead of reporting a reset that didn't happen.
    @State private var guideResetFailed = false

    var body: some View {
        TabView {
            launchTab
                .tabItem { Label("Launch", systemImage: "play.circle") }
            WorkflowsSettings()
                .tabItem { Label("Workflows", systemImage: "wand.and.stars") }
            projectAgentTab
                .tabItem { Label("Project agent", systemImage: "sparkles") }
            behaviorTab
                .tabItem { Label("Behavior", systemImage: "gearshape") }
            keybindsTab
                .tabItem { Label("Keybinds", systemImage: "keyboard") }
        }
        .frame(width: 540, height: 420)
        .padding()
    }

    private var launchTab: some View {
        Form {
            Section("Default launch command") {
                Toggle("Run a command automatically in new terminals", isOn: $settings.launchOnNewTerminal)
                Picker("Default agent", selection: defaultAgentSelection) {
                    ForEach(defaultAgentChoices, id: \.binaryName) { agent in
                        Text(agent.name).tag(agent.binaryName)
                    }
                    if selectedAgentBinary == "custom" {
                        Text("Custom").tag("custom")
                    }
                }
                .disabled(!settings.launchOnNewTerminal)
                TextField("Command", text: $settings.defaultLaunchCommand)
                    .font(.system(.body, design: .monospaced))
                    .disabled(!settings.launchOnNewTerminal)
                Text("e.g. claude --dangerously-skip-permissions, pi, kimi, or another agent CLI")
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

    /// Agents offered in the default-agent picker: every registered adapter
    /// IDEalize knows how to launch (custom screen-only profiles have no
    /// launch command, so they stay out).
    private var defaultAgentChoices: [AgentAdapter] {
        AgentRegistry.adapters.filter { $0.launchCommand != nil }
    }

    /// The adapter the current default command resolves to, or "custom" when
    /// the command doesn't match any registered agent.
    private var selectedAgentBinary: String {
        AgentRegistry.adapter(forCommand: settings.defaultLaunchCommand
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased())?.binaryName ?? "custom"
    }

    /// Picking an agent swaps the command for that agent's preferred launch;
    /// the text field below stays the place to add flags on top.
    private var defaultAgentSelection: Binding<String> {
        Binding(
            get: { selectedAgentBinary },
            set: { binary in
                guard let cmd = AgentRegistry.adapters
                    .first(where: { $0.binaryName == binary })?.launchCommand else { return }
                settings.defaultLaunchCommand = cmd
            }
        )
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

    // MARK: - Project agent

    /// The coordinating chat: when one appears, what it (and the chats it starts)
    /// runs on, the guide it works from, and — last, because almost nobody wants it
    /// — running a different agent for the job.
    private var projectAgentTab: some View {
        Form {
            Section("Starting") {
                Toggle("Start one automatically once a project has two chats",
                       isOn: $settings.projectAgentAutoStart)
                Text("A project agent is a chat whose job is the other chats: it keeps track of what each one is doing, notices when two are about to change the same thing, and can start new chats to take on pieces of the work. You can add one yourself at any time from the sidebar — with this off, IDEalize offers you one when a project gets busy instead.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Which model") {
                modelRows("Project agent",
                          value: $settings.projectAgentModel,
                          isCustom: $coordinatorModelIsCustom)
                Text("The project agent reads more than any other chat — everything each chat has said, plus a sweep of the whole project — so a smaller model, which has less room to remember, runs out of room here far sooner than it would in a chat that's building one thing. Haiku copes with a quiet project of two or three chats; a busy one is happier on Sonnet or Opus.")
                    .font(.caption).foregroundStyle(.secondary)
                modelRows("Chats it starts",
                          value: $settings.projectAgentChildModel,
                          isCustom: $childModelIsCustom)
                Text("These are the chats doing the actual building, so they're worth keeping on a capable model even when the project agent itself is on a cheap one.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("How it works") {
                Text(usesOwnGuide ? "Using your own edited guide" : "Using IDEalize's built-in guide")
                HStack {
                    Button("View built-in") { openGuide(ProjectAgent.builtInPromptURL) }
                    Button("Edit my own copy") { editOwnGuide() }
                    if usesOwnGuide {
                        Button("Reset to built-in") { confirmingGuideReset = true }
                    }
                }
                if builtInGuideMissing {
                    Label("IDEalize's built-in guide isn't in place yet — it's written out when the app starts, so quitting and reopening IDEalize should sort it.",
                          systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if guideResetFailed {
                    Label("Your copy couldn't be thrown away, so the project agent is still working from it. Check the file isn't open or locked elsewhere, then try again.",
                          systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if ownGuideIsBehind {
                    // Information, not a problem: their copy is exactly as they left
                    // it, and we will never rewrite it for them.
                    VStack(alignment: .leading, spacing: 4) {
                        Label("IDEalize's built-in guide has been updated since you started your copy. Your edits are untouched, which also means your copy doesn't include the changes.",
                              systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                        Button("See the built-in guide") { openGuide(ProjectAgent.builtInPromptURL) }
                            .buttonStyle(.link).font(.caption)
                    }
                }
                Text("This is the guide the project agent works from: how it keeps up with the other chats, when it comes to you for a decision, and what it may start on its own. Edit your own copy to change how it behaves — IDEalize's copy is left alone, so you can always go back to it.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("A different agent") {
                TextField("Command", text: $settings.projectAgentLaunchCommand,
                          prompt: Text("Same agent as my other chats"))
                    .font(.system(.body, design: .monospaced))
                Text("Leave this empty and the project agent uses the same agent as your other chats. Anything other than Claude can take neither the model chosen above nor the guide it normally reads invisibly, so the project agent would get its instructions only as an opening message — which most other agents follow less closely.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Lead agent") {
                Toggle("Start one automatically once two projects have project agents",
                       isOn: $settings.leadAgentAutoStart)
                Text("The lead agent is one chat above all the project agents: it keeps a board of what's moving in every project, makes the routine calls so the agents keep moving, learns how you like to work, and brings you only the decisions that are truly yours. It never builds anything itself. You can open one any time with the crown button in the toolbar.")
                    .font(.caption).foregroundStyle(.secondary)
                modelRows("Lead agent",
                          value: $settings.leadAgentModel,
                          isCustom: $leadModelIsCustom)
                Text("The lead reads the least of any chat — one-line status notes and project boards, never transcripts or code — so it's the natural place to run a cheaper model.")
                    .font(.caption).foregroundStyle(.secondary)
                Text(usesOwnLeadGuide ? "Using your own edited guide" : "Using IDEalize's built-in guide")
                HStack {
                    Button("View built-in") { openGuide(LeadAgent.builtInPromptURL) }
                    Button("Edit my own copy") { editOwnLeadGuide() }
                    if usesOwnLeadGuide {
                        Button("Reset to built-in") { confirmingLeadGuideReset = true }
                    }
                }
                if leadGuideResetFailed {
                    Label("Your copy couldn't be thrown away, so the lead agent is still working from it. Check the file isn't open or locked elsewhere, then try again.",
                          systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if ownLeadGuideIsBehind {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("IDEalize's built-in lead-agent guide has been updated since you started your copy. Your edits are untouched, which also means your copy doesn't include the changes.",
                              systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                        Button("See the built-in guide") { openGuide(LeadAgent.builtInPromptURL) }
                            .buttonStyle(.link).font(.caption)
                    }
                }
                TextField("Command", text: $settings.leadAgentLaunchCommand,
                          prompt: Text("Same agent as my other chats"))
                    .font(.system(.body, design: .monospaced))
            }
        }
        .formStyle(.grouped)
        .onAppear { refreshGuideState() }
        .confirmationDialog("Go back to IDEalize's built-in lead-agent guide?",
                            isPresented: $confirmingLeadGuideReset) {
            Button("Discard my copy", role: .destructive) {
                leadGuideResetFailed = !LeadAgent.resetCustomPrompt()
                refreshGuideState()
            }
            Button("Keep my copy", role: .cancel) {}
        } message: {
            Text("Your edited copy will be thrown away and the lead agent will go back to working from IDEalize's guide.")
        }
        .confirmationDialog("Go back to IDEalize's built-in guide?",
                            isPresented: $confirmingGuideReset) {
            Button("Discard my copy", role: .destructive) {
                guideResetFailed = !ProjectAgent.resetCustomPrompt()
                refreshGuideState()
            }
            Button("Keep my copy", role: .cancel) {}
        } message: {
            Text("Your edited copy will be thrown away and the project agent will go back to working from IDEalize's guide.")
        }
    }

    /// A model the project agent (or the chats it starts) can run on. These are
    /// Claude's CLI aliases rather than pinned model ids on purpose: an alias
    /// follows the latest release of that model instead of freezing on whichever
    /// version happened to be current when this build shipped.
    private struct ModelOption: Identifiable {
        let label: String
        let value: String
        var id: String { value }
    }

    private static let modelOptions: [ModelOption] = [
        .init(label: "Same as my chats", value: ""),
        .init(label: "Haiku — cheapest", value: "haiku"),
        .init(label: "Sonnet", value: "sonnet"),
        .init(label: "Opus", value: "opus"),
    ]

    /// Tag for the "Custom…" row. A control character can't be a real model name,
    /// so it can never collide with something the user typed in the field.
    private static let customModelTag = "\u{1}custom"

    /// A model picker plus, when "Custom…" is chosen, the free-form field it
    /// reveals. The picker can't bind to the stored string directly: the string is
    /// whatever the agent's `--model` accepts, so "Custom…" has to stay selected
    /// while the field is still empty (that's what `isCustom` carries), and a stored
    /// value that matches none of the presets has to come up as "Custom…" already
    /// (that falls out of the value simply not being one of them).
    @ViewBuilder
    private func modelRows(_ label: String,
                           value: Binding<String>,
                           isCustom: Binding<Bool>) -> some View {
        let isPreset = Self.modelOptions.contains { $0.value == value.wrappedValue }
        let showsCustomField = isCustom.wrappedValue || !isPreset
        Picker(label, selection: Binding(
            get: { showsCustomField ? Self.customModelTag : value.wrappedValue },
            set: { picked in
                if picked == Self.customModelTag {
                    // Keep whatever is stored as the field's starting point — moving
                    // from Sonnet to Custom… should show "sonnet", not blank.
                    isCustom.wrappedValue = true
                } else {
                    isCustom.wrappedValue = false
                    value.wrappedValue = picked
                }
            })) {
            ForEach(Self.modelOptions) { option in
                Text(option.label).tag(option.value)
            }
            Text("Custom…").tag(Self.customModelTag)
        }
        if showsCustomField {
            TextField("Model name", text: value, prompt: Text("e.g. claude-sonnet-4-5"))
                .font(.system(.body, design: .monospaced))
        }
    }

    /// Show a guide in the app's document panel. Deliberately *not*
    /// `Workspace.reveal(path:open:)`: that refuses paths with hidden components and
    /// insists the file sits inside an open project, and neither guide qualifies —
    /// the built-in lives in a dot-folder and the user's copy lives outside every
    /// project. Preferences is its own window, so we have to bring the main one
    /// forward ourselves.
    private func openGuide(_ url: URL) {
        guard FileManager.default.fileExists(atPath: url.path) else {
            builtInGuideMissing = true
            return
        }
        builtInGuideMissing = false
        Workspace.shared.viewedFile = url
        Workspace.shared.showViewer = true
        NSApp.activate(ignoringOtherApps: true)
    }

    private func editOwnGuide() {
        guard let url = ProjectAgent.seedCustomPrompt() else {
            builtInGuideMissing = true   // nothing to copy from yet
            return
        }
        refreshGuideState()
        openGuide(url)
    }

    private func refreshGuideState() {
        usesOwnGuide = ProjectAgent.usesCustomPrompt
        ownGuideIsBehind = ProjectAgent.customPromptIsBehind
        usesOwnLeadGuide = LeadAgent.usesCustomPrompt
        ownLeadGuideIsBehind = LeadAgent.customPromptIsBehind
    }

    private func editOwnLeadGuide() {
        guard let url = LeadAgent.seedCustomPrompt() else {
            builtInGuideMissing = true   // nothing to copy from yet
            return
        }
        refreshGuideState()
        openGuide(url)
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
            Section("Screen layout") {
                Picker("Column order", selection: $settings.workspaceLayout) {
                    ForEach(WorkspaceLayout.allCases) { layoutOption in
                        Text(layoutOption.displayName).tag(layoutOption)
                    }
                }
                Text("Standard keeps files and documents on the left of the terminal. Chat-focused puts the terminal next to your sessions, with documents opening to its right and files on the far right. Applies immediately.")
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

    // MARK: - Keybinds

    /// Every keyboard shortcut in the app, straight from the shared catalogue the
    /// ⌘/ overlay also reads — one list, two doors. Read-only on purpose: each
    /// shortcut is a real menu item, so there's nothing here to rebind (yet).
    private var keybindsTab: some View {
        Form {
            ForEach(ShortcutCatalog.groups, id: \.title) { group in
                Section(group.title) {
                    ForEach(group.items, id: \.action) { item in
                        LabeledContent(item.action) {
                            Text(item.keys)
                                .font(.system(.body, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section {
                Text("Every shortcut is also a menu item, so you can find them in the menu bar as you learn them. Press ⌘/ anywhere for this list as a floating overlay. Shortcuts can't be changed yet.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

