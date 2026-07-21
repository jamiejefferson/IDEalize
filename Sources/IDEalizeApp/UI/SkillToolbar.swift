import SwiftUI
import AppKit

/// One entry in the skills/commands catalog surfaced by the input toolbar.
struct CatalogItem: Identifiable, Hashable {
    enum Kind { case skill, command }
    let id = UUID()
    let name: String          // raw name (folder / file base)
    let description: String
    let kind: Kind
    let scope: String         // "project" / "user" / "built-in"

    /// A friendly, humanised title ("design-review" → "Design review").
    var title: String {
        let words = name.replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

/// Discovers Agent Skills and slash commands from the project and the user home.
/// Searches `.claude/…` (Claude), `.idealize/…` (agent-neutral), and built-ins.
enum SkillCatalog {
    static let builtins: [(String, String)] = [
        ("compact", "Summarise the conversation to reclaim context"),
        ("clear", "Start a fresh conversation"),
        ("review", "Review the current changes"),
        ("cost", "Show token usage and cost"),
        ("context", "See what's filling the context window"),
        ("init", "Generate an AGENTS.md for this project"),
        ("memory", "Edit the agent's memory files"),
    ]

    static func load(projectPath: String?) -> (skills: [CatalogItem], commands: [CatalogItem]) {
        var skills: [CatalogItem] = [], commands: [CatalogItem] = []
        var seenSkill = Set<String>(), seenCmd = Set<String>()
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser

        // Agent-neutral IDEalize skills/commands, then Claude-specific ones.
        var roots: [(URL, String)] = [
            (home.appendingPathComponent(".idealize"), "user"),
            (home.appendingPathComponent(".claude"), "user"),
        ]
        if let p = projectPath, !p.isEmpty, p != "/" {
            roots.insert((URL(fileURLWithPath: p).appendingPathComponent(".idealize"), "project"), at: 0)
            roots.insert((URL(fileURLWithPath: p).appendingPathComponent(".claude"), "project"), at: 1)
        }

        for (root, scope) in roots {
            let skillsDir = root.appendingPathComponent("skills")
            if let dirs = try? fm.contentsOfDirectory(at: skillsDir, includingPropertiesForKeys: [.isDirectoryKey]) {
                for d in dirs {
                    let md = d.appendingPathComponent("SKILL.md")
                    guard fm.fileExists(atPath: md.path) else { continue }
                    let (name, desc) = meta(md, fallback: d.lastPathComponent)
                    if seenSkill.insert(name.lowercased()).inserted {
                        skills.append(CatalogItem(name: name, description: desc, kind: .skill, scope: scope))
                    }
                }
            }
            let cmdDir = root.appendingPathComponent("commands")
            if let files = try? fm.contentsOfDirectory(at: cmdDir, includingPropertiesForKeys: nil) {
                for f in files where f.pathExtension == "md" {
                    let name = f.deletingPathExtension().lastPathComponent
                    // Command names are typed verbatim into the shell when clicked
                    // (`/name`), so only names without shell metacharacters are
                    // safe to offer.
                    guard isSafeName(name) else { continue }
                    let (_, desc) = meta(f, fallback: name)
                    if seenCmd.insert(name.lowercased()).inserted {
                        commands.append(CatalogItem(name: name, description: desc, kind: .command, scope: scope))
                    }
                }
            }
        }
        for (n, d) in builtins where seenCmd.insert(n).inserted {
            commands.append(CatalogItem(name: n, description: d, kind: .command, scope: "built-in"))
        }
        skills.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        commands.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return (skills, commands)
    }

    /// Command names run verbatim in the shell, so allow only `[A-Za-z0-9._-]`.
    private static let safeNameCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
    private static func isSafeName(_ name: String) -> Bool {
        !name.isEmpty && name.unicodeScalars.allSatisfy(safeNameCharacters.contains)
    }

    private static let blockIndicators: Set<String> = ["|", "|-", "|+", ">", ">-", ">+"]

    private static func meta(_ url: URL, fallback: String) -> (String, String) {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return (fallback, "") }
        let lines = text.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            let first = lines.first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
            return (fallback, strip(first.replacingOccurrences(of: "#", with: "")))
        }
        var name = fallback, desc = ""
        var i = 1
        while i < lines.count {
            let t = lines[i].trimmingCharacters(in: .whitespaces)
            if t == "---" { break }
            if t.hasPrefix("name:") {
                name = strip(String(t.dropFirst(5)))
            } else if t.hasPrefix("description:") {
                let val = strip(String(t.dropFirst(12)))
                if val.isEmpty || blockIndicators.contains(val) {
                    // YAML block scalar — gather the following indented lines.
                    var parts: [String] = []
                    var j = i + 1
                    while j < lines.count {
                        let l = lines[j]
                        let lt = l.trimmingCharacters(in: .whitespaces)
                        if lt == "---" { break }
                        // A new unindented key ends the block.
                        if !l.hasPrefix(" ") && !l.hasPrefix("\t") && !lt.isEmpty { break }
                        if !lt.isEmpty { parts.append(lt) }
                        j += 1
                    }
                    desc = parts.joined(separator: " ")
                    i = j
                    continue
                } else {
                    desc = val
                }
            }
            i += 1
        }
        if desc.count > 240 { desc = String(desc.prefix(240)) + "…" }
        return (name.isEmpty ? fallback : name, desc)
    }

    private static func strip(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }
}

// MARK: - Shared pill chrome

private struct Pill: View {
    let icon: String
    let text: String
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    init(_ icon: String, _ text: String) { self.icon = icon; self.text = text }
    private var theme: Theme { settings.theme }
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11))
                .foregroundStyle(settings.actionStyle.color)
            Text(text).font(settings.ui(11, .medium)).foregroundStyle(Color(theme.foreground))
            Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
                .foregroundStyle(Color(theme.secondaryForeground))
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Capsule().fill(Color(hovering ? theme.surfaceHover : theme.surface)))
        .overlay(Capsule().strokeBorder(
            hovering ? settings.actionStyle.color.opacity(0.5) : Color(theme.border), lineWidth: 1))
        .contentShape(Capsule())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

// MARK: - The toolbar (model · effort · skills · commands)

struct ChatToolbar: View {
    @ObservedObject var session: TerminalSession
    @Binding var draft: String
    /// Switches the chat region between the conversation and the Flows designer —
    /// the "second view" in the input field.
    @Binding var flowMode: Bool
    /// The flow library lives beside the toggle: save the working flow, or open a
    /// saved one. Only surfaced while designing a flow.
    @ObservedObject var flowStore: FlowStore
    var focus: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            FlowModeToggle(on: $flowMode)
                .tourTarget(.flow)
            if flowMode {
                FlowLibraryButton(flowStore: flowStore)
                VersionHistoryButton(flowStore: flowStore)
                Spacer(minLength: 0)
            } else {
                // The action pills scroll horizontally rather than clip when the
                // pane is narrow — the toggle stays pinned on the left.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        if session.currentAgent?.supportsRuntimeModelSwitch == true {
                            ModelPill(session: session)
                        }
                        if session.currentAgent?.supportsReasoningEffort == true {
                            EffortPill(session: session)
                        }
                        SkillsPill(session: session, draft: $draft, focus: focus)
                        CommandsPill(session: session)
                    }
                    .padding(.trailing, 2)
                }
            }
        }
    }
}

/// A sliding two-icon toggle flipping the chat region between the conversation
/// and the Flows designer. Deliberately the same slide-toggle language as the pane's
/// Chat/Terminal `ModeToggle` — a springy knob under the active icon, icons that
/// bounce, a press dip — so the two reads as members of one family.
private struct FlowModeToggle: View {
    @Binding var on: Bool
    @ObservedObject private var settings = AppSettings.shared
    @State private var pressed = false
    private var theme: Theme { settings.theme }

    private let slot: CGFloat = 30
    private let height: CGFloat = 24

    var body: some View {
        ZStack(alignment: on ? .trailing : .leading) {
            // Track.
            Capsule()
                .fill(Color(theme.surface).opacity(0.95))
                .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))
            // Sliding knob.
            Capsule()
                .fill(settings.actionStyle.fill)
                .frame(width: slot - 4, height: height - 4)
                .padding(2)
                .shadow(color: .black.opacity(0.28), radius: 3, y: 1)
            // Icons.
            HStack(spacing: 0) {
                icon("bubble.left.fill", active: !on)
                icon("arrow.triangle.branch", active: on)
            }
        }
        .frame(width: slot * 2, height: height)
        .scaleEffect(pressed ? 0.93 : 1)
        .animation(.spring(response: 0.34, dampingFraction: 0.6), value: on)
        .animation(.spring(response: 0.25, dampingFraction: 0.55), value: pressed)
        .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
        .contentShape(Capsule())
        .onLongPressGesture(minimumDuration: 0.6, maximumDistance: 40,
                            perform: {}, onPressingChanged: { pressed = $0 })
        .simultaneousGesture(TapGesture().onEnded {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.6)) { on.toggle() }
        })
        .help(on ? "Back to chat" : "Design a flow — describe the outcome and let the interview build it")
    }

    private func icon(_ name: String, active: Bool) -> some View {
        Image(systemName: name)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(active ? .white : Color(theme.secondaryForeground))
            .scaleEffect(active ? 1 : 0.82)
            .symbolEffect(.bounce, value: on)
            .frame(width: slot, height: height)
    }
}

/// The flow library, sat beside the toggle while designing: save the working flow
/// under a name, or re-open a saved one. Storage is the global flows folder
/// (see `FlowStore`), so flows are available in every project.
private struct FlowLibraryButton: View {
    @ObservedObject var flowStore: FlowStore
    @State private var open = false
    @ObservedObject private var settings = AppSettings.shared

    var body: some View {
        Button(action: { open.toggle() }) { Pill("tray.full", "Library") }
            .buttonStyle(.plain)
            .help("Open the flows library")
            .popover(isPresented: $open, arrowEdge: .top) {
                FlowsLibraryView(flowStore: flowStore,
                                 onRun: { _ in open = false },
                                 onEdit: { ref in
                                     flowStore.openSaved(ref)
                                     open = false
                                 },
                                 onClose: { open = false })
            }
    }
}

/// A button that opens the version history for the working flow.
private struct VersionHistoryButton: View {
    @ObservedObject var flowStore: FlowStore
    @State private var open = false
    @ObservedObject private var settings = AppSettings.shared

    var body: some View {
        Button(action: { open.toggle() }) { Pill("clock.arrow.circlepath", "History") }
            .buttonStyle(.plain)
            .help("Browse and restore previous versions")
            .popover(isPresented: $open, arrowEdge: .top) {
                FlowsVersionHistoryView(flowStore: flowStore,
                                        onClose: { open = false })
            }
    }
}

private struct ModelPill: View {
    @ObservedObject var session: TerminalSession
    @State private var open = false
    static let models: [(label: String, id: String, blurb: String)] = [
        ("Auto", "default", "Let the agent choose"),
        ("Opus", "opus", "Most capable"),
        ("Sonnet", "sonnet", "Balanced & fast"),
        ("Haiku", "haiku", "Fastest"),
    ]
    var body: some View {
        Button(action: { open.toggle() }) { Pill("brain.head.profile", session.modelLabel) }
            .buttonStyle(.plain)
            .help("\(session.currentAgent?.name ?? "Agent") model")
            .popover(isPresented: $open, arrowEdge: .top) {
                OptionList(title: "Model",
                           options: Self.models.map { ($0.label, $0.blurb) },
                           current: session.modelLabel) { label in
                    if let m = Self.models.first(where: { $0.label == label }) { session.setModel(m.id, m.label) }
                    open = false
                }
            }
    }
}

private struct EffortPill: View {
    @ObservedObject var session: TerminalSession
    @State private var open = false

    /// Levels derived from the active agent's effort keywords, if any.
    private var levels: [(label: String, keyword: String, blurb: String)] {
        var list: [(String, String, String)] = [("Standard", "", "Answers directly")]
        if let keywords = session.currentAgent?.effortKeywords {
            for (label, keyword) in keywords.sorted(by: { $0.key < $1.key }) {
                list.append((label, keyword, "Thinks \(label.lowercased())"))
            }
        }
        return list
    }

    var body: some View {
        Button(action: { open.toggle() }) { Pill("speedometer", session.effortLabel) }
            .buttonStyle(.plain)
            .help("How long the agent thinks before answering")
            .popover(isPresented: $open, arrowEdge: .top) {
                OptionList(title: "Effort",
                           options: levels.map { ($0.label, $0.blurb) },
                           current: session.effortLabel) { label in
                    if let l = levels.first(where: { $0.label == label }) { session.setEffort(l.keyword, l.label) }
                    open = false
                }
            }
    }
}

/// A compact options list shown in a pill's popover.
private struct OptionList: View {
    let title: String
    let options: [(label: String, blurb: String)]
    let current: String
    let onSelect: (String) -> Void
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title.uppercased()).font(settings.ui(9, .semibold)).tracking(0.8)
                .foregroundStyle(Color(theme.secondaryForeground))
                .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 4)
            ForEach(options, id: \.label) { opt in
                Button(action: { onSelect(opt.label) }) {
                    HStack(spacing: 9) {
                        Image(systemName: opt.label == current ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 12))
                            .foregroundStyle(opt.label == current ? settings.actionStyle.color : Color(theme.secondaryForeground))
                            .frame(width: 16)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(opt.label).font(settings.ui(12, .medium)).foregroundStyle(Color(theme.foreground))
                            Text(opt.blurb).font(settings.ui(10)).foregroundStyle(Color(theme.secondaryForeground))
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(HoverRowStyle())
            }
        }
        .padding(.bottom, 6)
        .frame(width: 220)
        .background(Color(theme.chrome))
    }
}

private struct SkillsPill: View {
    @ObservedObject var session: TerminalSession
    @Binding var draft: String
    var focus: () -> Void
    @State private var open = false
    var body: some View {
        Button(action: { open.toggle() }) { Pill("wand.and.stars", "Skills") }
            .buttonStyle(.plain)
            .help("Use one of your skills")
            .popover(isPresented: $open, arrowEdge: .top) {
                CatalogPopover(projectPath: session.projectPath, kind: .skill, title: "Skills") { item in
                    // Skills take a task — stage the invocation for you to finish.
                    draft = "Use the \(item.name) skill to "
                    open = false
                    focus()
                }
            }
    }
}

private struct CommandsPill: View {
    @ObservedObject var session: TerminalSession
    @State private var open = false
    var body: some View {
        Button(action: { open.toggle() }) { Pill("bolt.fill", "Commands") }
            .buttonStyle(.plain)
            .help("Run a slash command")
            .popover(isPresented: $open, arrowEdge: .top) {
                CatalogPopover(projectPath: session.projectPath, kind: .command, title: "Commands") { item in
                    open = false
                    session.runCommand("/\(item.name)")   // commands run immediately
                }
            }
    }
}

// MARK: - Searchable list popover

private struct CatalogPopover: View {
    let projectPath: String?
    let kind: CatalogItem.Kind
    let title: String
    let onChoose: (CatalogItem) -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var query = ""
    @State private var items: [CatalogItem] = []

    private var theme: Theme { settings.theme }

    private var filtered: [CatalogItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter { $0.title.lowercased().contains(q) || $0.description.lowercased().contains(q) || $0.name.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
                TextField("Search \(title.lowercased())", text: $query)
                    .textFieldStyle(.plain).font(settings.ui(12))
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(filtered) { item in row(item) }
                    if filtered.isEmpty {
                        Text("No matches").font(settings.ui(11))
                            .foregroundStyle(Color(theme.secondaryForeground)).padding(16)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(width: 330, height: 400)
        .background(Color(theme.chrome))
        .onAppear {
            let r = SkillCatalog.load(projectPath: projectPath)
            items = kind == .skill ? r.skills : r.commands
        }
    }

    private func row(_ item: CatalogItem) -> some View {
        Button(action: { onChoose(item) }) {
            HStack(spacing: 9) {
                Image(systemName: item.kind == .skill ? "wand.and.stars" : "bolt.fill")
                    .font(.system(size: 11)).foregroundStyle(settings.actionStyle.color)
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title).font(settings.ui(12, .medium))
                        .foregroundStyle(Color(theme.foreground)).lineLimit(1)
                    if !item.description.isEmpty {
                        Text(item.description).font(settings.ui(10))
                            .foregroundStyle(Color(theme.secondaryForeground))
                            .lineLimit(2).truncationMode(.tail)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(HoverRowStyle())
    }
}

/// A list-row button that highlights on hover.
private struct HoverRowStyle: ButtonStyle {
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? Color(settings.theme.surfaceHover) : .clear)
            .onHover { hovering = $0 }
    }
}
