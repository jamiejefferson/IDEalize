import Foundation

/// A saved, optionally parameterized command — Warp's "Workflows".
/// Parameters are referenced in `command` as `{{name}}`.
struct Workflow: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var command: String
    var description: String?
    var parameters: [Parameter]

    struct Parameter: Identifiable, Codable, Equatable {
        var id = UUID()
        var name: String
        var defaultValue: String?
        var placeholder: String?
    }

    /// Placeholders actually present in the command, in order of appearance.
    var detectedParameters: [String] {
        var result: [String] = []
        var seen = Set<String>()
        let scanner = command as NSString
        var range = NSRange(location: 0, length: scanner.length)
        while range.location < scanner.length {
            let open = scanner.range(of: "{{", options: [], range: range)
            if open.location == NSNotFound { break }
            let afterOpen = open.location + open.length
            let rest = NSRange(location: afterOpen, length: scanner.length - afterOpen)
            let close = scanner.range(of: "}}", options: [], range: rest)
            if close.location == NSNotFound { break }
            let nameRange = NSRange(location: afterOpen, length: close.location - afterOpen)
            let name = scanner.substring(with: nameRange).trimmingCharacters(in: .whitespaces)
            if !name.isEmpty, !seen.contains(name) { seen.insert(name); result.append(name) }
            range = NSRange(location: close.location + close.length,
                            length: scanner.length - (close.location + close.length))
        }
        return result
    }

    /// Substitute parameter values into the command.
    func resolved(with values: [String: String]) -> String {
        var out = command
        for (key, value) in values {
            out = out.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return out
    }
}

/// Persists workflows to JSON and seeds useful starters.
final class WorkflowStore: ObservableObject {
    static let shared = WorkflowStore()

    @Published private(set) var workflows: [Workflow] = []

    private var fileURL: URL {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("workflows.json")
    }

    private init() {
        load()
        if workflows.isEmpty { workflows = WorkflowStore.starters; save() }
    }

    func add(_ workflow: Workflow) { workflows.append(workflow); save() }

    func remove(_ workflow: Workflow) {
        workflows.removeAll { $0.id == workflow.id }
        save()
    }

    func update(_ workflow: Workflow) {
        if let idx = workflows.firstIndex(where: { $0.id == workflow.id }) {
            workflows[idx] = workflow; save()
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Workflow].self, from: data) else { return }
        workflows = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(workflows) else { return }
        try? data.write(to: fileURL)
    }

    static let starters: [Workflow] = [
        Workflow(name: "Launch Claude Code",
                 command: "claude --dangerously-skip-permissions",
                 description: "Start Claude Code in this directory", parameters: []),
        Workflow(name: "Git: commit all",
                 command: "git add -A && git commit -m \"{{message}}\"",
                 description: "Stage everything and commit",
                 parameters: [.init(name: "message", defaultValue: nil, placeholder: "commit message")]),
        Workflow(name: "Git: new branch",
                 command: "git switch -c {{branch}}",
                 description: "Create and switch to a branch",
                 parameters: [.init(name: "branch", defaultValue: nil, placeholder: "branch-name")]),
        Workflow(name: "Kill port",
                 command: "lsof -ti tcp:{{port}} | xargs kill -9",
                 description: "Free a TCP port",
                 parameters: [.init(name: "port", defaultValue: "3000", placeholder: "3000")]),
        Workflow(name: "Tail log",
                 command: "tail -f {{file}}",
                 description: "Follow a log file",
                 parameters: [.init(name: "file", defaultValue: nil, placeholder: "path/to.log")]),
    ]
}
