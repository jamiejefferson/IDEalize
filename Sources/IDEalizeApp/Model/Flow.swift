import Foundation

/// A user-sketched flow: a job broken into simple steps. This file is the single
/// source of truth — the UI derives all layout from block order and connections.
/// There are NO coordinates anywhere in the data; Claude reads and writes the
/// file, never the pixels.
///
/// Ownership zones (load-bearing): the UI owns `title` and `flow`; Claude owns
/// `review` and `run`. Neither writes the other's zone. On send the UI writes
/// `flow`; on return Claude writes `review` (review turn) or `run` (run turn).
/// Absence of `review` is the default state; absence of `run` means "never run".
struct Flow: Codable, Equatable {
    var title: String
    var flow: Graph
    /// Written only by Claude (the `flow-review` command). `nil` until a review runs.
    var review: FlowReview?
    /// Written only by Claude (the `flow-run` skill), checkpointed after each step.
    /// Its presence is what lets a stopped run be picked up where it left off — the
    /// pause/resume contract lives entirely in this zone, on disk.
    var run: FlowRun?

    struct Graph: Codable, Equatable {
        var blocks: [FlowBlock]
        var connections: [FlowConnection]
    }
}

/// One step. `type` drives the icon/affordances; `text` is always plain language.
///
/// A `tool` block is always `{ type: tool, text: "<plain words>" }` — there are
/// no per-tool fields and no schemas. The user writes what they want and Claude
/// interprets it at run time. The action picker only pre-fills `text`; it adds
/// no structure. That is what lets one block type cover every action.
struct FlowBlock: Codable, Equatable, Identifiable {
    var id: String
    var type: FlowBlockType
    var text: String
    /// Authored per block in a template, so the same type can hint differently in
    /// different templates. Not part of the contract Claude reads — UI-only.
    var hint: String?

    enum CodingKeys: String, CodingKey { case id, type, text }
}

enum FlowBlockType: String, Codable, CaseIterable {
    case start, decision, tool, end

    var label: String {
        switch self {
        case .start: return "Start"
        case .decision: return "Decision"
        case .tool: return "Action"
        case .end: return "End"
        }
    }

    /// SF Symbol for the card's type badge.
    var icon: String {
        switch self {
        case .start: return "play.circle.fill"
        case .decision: return "arrow.triangle.branch"
        case .tool: return "wrench.and.screwdriver.fill"
        case .end: return "stop.circle.fill"
        }
    }
}

/// A directed arrow between two blocks. `label` distinguishes a decision's
/// branches ("yes" / "no"). No positions — order and connections are layout.
struct FlowConnection: Codable, Equatable, Identifiable {
    var from: String
    var to: String
    var label: String?

    var id: String { "\(from)->\(to)" }
}

// MARK: - Review (Claude's zone)

/// Claude's structured feedback, rendered back onto the canvas. The UI never
/// writes this. `verdict` gates the run button.
struct FlowReview: Codable, Equatable {
    var verdict: Verdict
    var summary: String
    var notes: [Note]

    enum Verdict: String, Codable {
        case ready
        case needsWork = "needs-work"
    }

    /// An issue pinned to a block by `id` (never by position, so it survives
    /// reorders). `issue` and `suggestion` are one line each, plain language.
    struct Note: Codable, Equatable, Identifiable {
        var block: String
        var issue: String
        var suggestion: String

        var id: String { block + issue }
    }
}

// MARK: - Run state (Claude's zone — the pause/resume checkpoint)

/// A flow's execution progress, checkpointed to disk by the `flow-run` skill after
/// every block. This is the whole of pause/resume: there is no separate "pause"
/// action — every checkpoint is a safe stopping point, and a run is resumed by
/// continuing from `nextBlock`. The UI reads this to badge each step and to offer
/// Resume; it never writes it (Claude's zone, like `review`).
struct FlowRun: Codable, Equatable {
    var status: Status
    /// The block to execute next — where a resume picks up. `nil` once the flow has
    /// reached an end (status `done`).
    var nextBlock: String?
    /// Steps finished so far, in run order, each with a one-line plain outcome.
    var completed: [Step]
    /// Decision outcomes taken so far: block id → the branch label that was chosen.
    var branches: [String: String]
    /// When the last checkpoint was written (ISO-8601), authored by Claude. Display
    /// only — never parsed for control flow.
    var updatedAt: String?

    enum Status: String, Codable {
        case running        // mid-run (also the state a stopped run is left in)
        case paused         // explicitly parked by Claude
        case done           // reached an end block
        case failed         // could not continue (Claude says why in the chat)
    }

    struct Step: Codable, Equatable, Identifiable {
        var block: String
        var result: String
        var id: String { block }
    }

    /// True when there is unfinished work to pick up — drives the editor's Resume.
    /// A failed run is resumable too: its `nextBlock` is the step to retry once the
    /// blocker clears. Only a `done` run (no `nextBlock`) is not.
    var isResumable: Bool {
        status != .done && nextBlock != nil
    }
}

/// How a single step stands in the current run, used to badge spine cards.
enum BlockRunState { case done, current, pending }

extension Flow {
    /// Run status per block id, or an empty map when the flow has never run. A
    /// completed step is `done`, `run.nextBlock` is `current`, everything else
    /// reachable is `pending` — so a paused flow reads at a glance.
    func runStateByBlock() -> [String: BlockRunState] {
        guard let run = run else { return [:] }
        var map: [String: BlockRunState] = [:]
        for step in run.completed { map[step.block] = .done }
        if let next = run.nextBlock { map[next] = .current }
        for b in flow.blocks where map[b.id] == nil { map[b.id] = .pending }
        return map
    }
}

// MARK: - Stable, non-positional ids

extension Flow.Graph {
    /// Generate an id no existing block uses. Inserting or reordering must never
    /// renumber existing ids, because review notes are pinned by id. We scan for
    /// the highest `b<n>` and add one, so ids are stable and monotonic.
    func nextBlockID() -> String {
        let maxN = blocks.compactMap { block -> Int? in
            guard block.id.hasPrefix("b") else { return nil }
            return Int(block.id.dropFirst())
        }.max() ?? 0
        return "b\(maxN + 1)"
    }
}

// MARK: - Editing (mutate blocks + connections by id; layout re-derives)

/// All structural edits live here, in the model, so the no-coordinate invariant
/// is enforced in one place: the UI never touches connections directly, it asks
/// the graph to splice/rewire and lets `spine()` re-derive the layout. Every
/// mutation targets blocks by stable id, so review notes pinned by id survive.
///
/// Branching is emergent, not a flag: a block forks iff it has 2+ outgoing
/// connections (`spine()` decides purely on out-degree). `type` only drives the
/// icon/affordances. So "add a branch" is just "add a second outgoing edge."
extension Flow.Graph {
    private func index(of id: String) -> Int? { blocks.firstIndex { $0.id == id } }

    /// Edit a block's plain-language text in place.
    mutating func setText(_ id: String, _ text: String) {
        guard let i = index(of: id) else { return }
        blocks[i].text = text
    }

    /// Change a block's type. Layout is unaffected (forking is decided by
    /// out-degree, not type) — this only swaps the icon and affordances.
    mutating func setType(_ id: String, _ type: FlowBlockType) {
        guard let i = index(of: id) else { return }
        blocks[i].type = type
    }

    /// Insert a fresh linear step immediately after `id`, splicing it into the
    /// column: `id → after` becomes `id → new → after` (the onward edge's label
    /// rides along to `new → after`). If `id` was a tail, the new block extends
    /// it. Only valid after a linear block (out-degree ≤ 1); decisions branch via
    /// `addBranch` instead.
    @discardableResult
    mutating func insert(after id: String, type: FlowBlockType = .tool) -> String {
        let newID = nextBlockID()
        let onward = connections.first { $0.from == id }   // id → after (if any)
        let new = FlowBlock(id: newID, type: type, text: "", hint: nil)
        if let i = index(of: id) {
            blocks.insert(new, at: min(i + 1, blocks.count))
        } else {
            blocks.append(new)
        }
        if let onward {
            connections.removeAll { $0.from == onward.from && $0.to == onward.to }
            connections.append(FlowConnection(from: id, to: newID, label: nil))
            connections.append(FlowConnection(from: newID, to: onward.to, label: onward.label))
        } else {
            connections.append(FlowConnection(from: id, to: newID, label: nil))
        }
        return newID
    }

    /// Append a new labelled branch off `id`: a fresh leaf block plus an edge
    /// `id → leaf`. The second such edge is what turns `id` into a fork, so we
    /// also stamp its type as `.decision` for the matching icon.
    @discardableResult
    mutating func addBranch(from id: String, label: String, leaf: FlowBlockType = .tool) -> String {
        // If this branch is what converts a linear block into a fork, backfill the
        // pre-existing unlabeled edge with "yes" so both paths read clearly instead
        // of leaving a mystery "—" branch next to the new one.
        let existing = connections.filter { $0.from == id }
        if existing.count == 1, (existing[0].label ?? "").isEmpty {
            setBranchLabel(from: id, to: existing[0].to, label: "yes")
        }
        let newID = nextBlockID()
        let leafBlock = FlowBlock(id: newID, type: leaf, text: "", hint: nil)
        if let i = index(of: id) {
            blocks.insert(leafBlock, at: min(i + 1, blocks.count))
        } else {
            blocks.append(leafBlock)
        }
        connections.append(FlowConnection(from: id, to: newID, label: label))
        setType(id, .decision)
        return newID
    }

    /// Relabel one outgoing branch of a fork (the "yes"/"no" capsule).
    mutating func setBranchLabel(from: String, to: String, label: String) {
        guard let i = connections.firstIndex(where: { $0.from == from && $0.to == to }) else { return }
        connections[i].label = label
    }

    /// Delete a block and heal the graph: every predecessor is rewired to the
    /// block's first successor (preserving the predecessor edge's label), so a
    /// linear column stays connected. A fork's extra successors become loose
    /// roots — acceptable for the MVP, and the user sees them immediately. Won't
    /// delete the last remaining block.
    mutating func delete(_ id: String) {
        guard blocks.count > 1, index(of: id) != nil else { return }
        let successor = connections.first { $0.from == id }?.to
        let incoming = connections.filter { $0.to == id }
        connections.removeAll { $0.from == id || $0.to == id }
        if let successor {
            for edge in incoming where !connections.contains(where: { $0.from == edge.from && $0.to == successor }) {
                connections.append(FlowConnection(from: edge.from, to: successor, label: edge.label))
            }
        }
        blocks.removeAll { $0.id == id }
    }

    /// The last block of the main column — where "add step" appends. The main
    /// column ends at a fork (branches own their own tails), so a forked last row
    /// has no clean linear tail; we fall back to the final authored block then.
    func tailID() -> String? {
        if let last = spine().last, last.branches.isEmpty { return last.block.id }
        return blocks.last?.id
    }
}

// MARK: - Layout derivation (no coordinates — order + connections only)

/// A laid-out row in the spine: one block, with any branches hanging beneath it.
/// A linear block has no branches; a decision has one branch per labelled
/// outgoing connection. Branches terminate (MVP) — they do not merge.
struct SpineRow: Identifiable {
    let block: FlowBlock
    let branches: [SpineBranch]
    var id: String { block.id }
}

struct SpineBranch: Identifiable {
    /// Stable identity tied to the originating connection (`from->to`), never the
    /// editable `label`. Using the label would collide on duplicate branches and
    /// churn identity mid-edit (clearing the label would steal text-field focus).
    let id: String
    let label: String
    let rows: [SpineRow]
}

extension Flow.Graph {
    private func block(_ id: String) -> FlowBlock? { blocks.first { $0.id == id } }

    /// Build the spine top-to-bottom from the `start` block (or the first block),
    /// following connections. A block with one outgoing connection continues the
    /// column; a block with several becomes a decision whose branches each recurse
    /// into their own sub-spine. `visited` guards against cycles and shared nodes.
    func spine() -> [SpineRow] {
        guard let root = blocks.first(where: { $0.type == .start }) ?? blocks.first
        else { return [] }
        var visited = Set<String>()
        var rows = buildColumn(from: root.id, visited: &visited)
        // Totality: a block unreachable from the root (e.g. an orphan left when a
        // fork is deleted) still renders, appended as its own root column in
        // authored order. So `spine()` draws *every* block — nothing survives
        // invisibly in the data, and in the editor an orphan stays deletable.
        for block in blocks where !visited.contains(block.id) {
            rows.append(contentsOf: buildColumn(from: block.id, visited: &visited))
        }
        return rows
    }

    /// Ids reachable from the start (or first) block by following connections —
    /// everything `spine()` draws before it backfills orphans. The editor uses the
    /// complement to flag disconnected roots (purely structural; not Claude's job).
    func reachableIDs() -> Set<String> {
        guard let root = blocks.first(where: { $0.type == .start }) ?? blocks.first
        else { return [] }
        var visited = Set<String>()
        _ = buildColumn(from: root.id, visited: &visited)
        return visited
    }

    private func buildColumn(from startID: String, visited: inout Set<String>) -> [SpineRow] {
        var rows: [SpineRow] = []
        var current: String? = startID
        while let cur = current, !visited.contains(cur), let blk = block(cur) {
            visited.insert(cur)
            let outs = connections.filter { $0.from == cur }
            if outs.count <= 1 {
                rows.append(SpineRow(block: blk, branches: []))
                current = outs.first?.to
            } else {
                // Decision: each outgoing connection becomes a labelled sub-spine.
                var branches: [SpineBranch] = []
                for conn in outs {
                    let sub = buildColumn(from: conn.to, visited: &visited)
                    branches.append(SpineBranch(id: "\(cur)->\(conn.to)", label: conn.label ?? "", rows: sub))
                }
                rows.append(SpineRow(block: blk, branches: branches))
                current = nil   // the column ends at the fork
            }
        }
        return rows
    }
}

// MARK: - Pre-flight validation (deterministic, no LLM)

/// A structural problem found by the deterministic pre-flight, before any Claude
/// review runs. Mirrors `FlowReview.Note` (pinned to a block by stable id) but is
/// owned by the UI/model, never by Claude. The split is the load-bearing idea
/// borrowed from Microsoft's Conductor: keep the orchestration/validation layer
/// LLM-free — structure is checked here for free, in zero tokens; *meaning* is
/// Claude's job in `review`. A flow with structural errors never reaches Claude,
/// so no turn is spent reviewing something that can't run.
struct FlowIssue: Identifiable, Equatable {
    enum Severity { case error, warning }
    var severity: Severity
    /// The block this is pinned to, or nil for a whole-flow issue.
    var block: String?
    var message: String
    var fix: String

    var id: String { (block ?? "_flow") + message }
}

extension Flow.Graph {
    /// Deterministic structural lint. Catches the broken-structure cases Claude
    /// shouldn't have to spend a turn on: no start, stranded steps, forks that
    /// don't fork, loops that never end, paths that just trail off. Errors are
    /// returned before warnings. An empty graph returns nothing — the editor's
    /// empty state already speaks for that.
    func validate() -> [FlowIssue] {
        guard !blocks.isEmpty else { return [] }
        var errors: [FlowIssue] = [], warnings: [FlowIssue] = []

        // 1. One clear entry point. (Conductor: every workflow has a defined start.)
        let starts = blocks.filter { $0.type == .start }
        if starts.isEmpty {
            errors.append(FlowIssue(severity: .error, block: nil,
                message: "No start step",
                fix: "Mark the first step as a Start so the flow has a clear beginning."))
        } else {
            for s in starts.dropFirst() {
                warnings.append(FlowIssue(severity: .warning, block: s.id,
                    message: "A second start step",
                    fix: "A flow runs from one beginning — make this an Action or Decision."))
            }
        }

        // 2. Nothing stranded. Reuses the spine's reachability — an unreachable
        //    block is a missing dependency in Conductor's terms.
        let reachable = reachableIDs()
        for b in blocks where !reachable.contains(b.id) {
            errors.append(FlowIssue(severity: .error, block: b.id,
                message: "Not connected to the flow",
                fix: "Wire this into the flow, or delete it — nothing reaches it."))
        }

        // 3. A decision must actually branch. Branching is out-degree, so a
        //    decision with one way out is a routing dead-end.
        for b in blocks {
            let outs = connections.filter { $0.from == b.id }
            if b.type == .decision, outs.count < 2 {
                errors.append(FlowIssue(severity: .error, block: b.id,
                    message: "Decision with only one way out",
                    fix: "Add a second branch, or change this to an Action."))
            }
            // Unlabeled fork branches read as a mystery path at run time
            // (Conductor: first matching condition wins — the labels are the
            // conditions, so each must be legible).
            if outs.count >= 2 {
                for e in outs where (e.label ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                    warnings.append(FlowIssue(severity: .warning, block: b.id,
                        message: "A branch with no label",
                        fix: "Name each branch (e.g. \"yes\" / \"no\") so the choice is clear."))
                    break   // one nudge per fork is enough
                }
            }
        }

        // 4. Every step needs words — Claude reads `text`, never the pixels.
        for b in blocks where b.text.trimmingCharacters(in: .whitespaces).isEmpty {
            warnings.append(FlowIssue(severity: .warning, block: b.id,
                message: "Empty step",
                fix: "Describe what happens here in plain words."))
        }

        // 5. Explicit termination (Conductor's safety control): every path should
        //    stop on an End. A reachable leaf that isn't an End just trails off.
        for b in blocks {
            let isLeaf = !connections.contains { $0.from == b.id }
            if isLeaf, b.type != .end, reachable.contains(b.id) {
                warnings.append(FlowIssue(severity: .warning, block: b.id,
                    message: "This path just stops",
                    fix: "Add a next step, or mark this as an End."))
            }
        }

        // 6. No runaway loops — a back-edge would loop forever at run time
        //    (Conductor guards this with iteration limits; a sketched flow simply
        //    shouldn't contain one).
        for id in cycleNodeIDs() {
            errors.append(FlowIssue(severity: .error, block: id,
                message: "Loops back on itself",
                fix: "Remove the branch pointing back upstream — flows run start to end."))
        }

        return errors + warnings
    }

    /// Ids lying on a cycle (a step reachable from itself by following
    /// connections). `spine()` silently breaks cycles to lay out the column; here
    /// we name them so the user can cut the offending back-edge.
    func cycleNodeIDs() -> Set<String> {
        var onStack = Set<String>(), visited = Set<String>(), cyclic = Set<String>()
        func dfs(_ id: String, _ path: [String]) {
            visited.insert(id); onStack.insert(id)
            for e in connections where e.from == id {
                if onStack.contains(e.to) {
                    // Everything from e.to forward to id is on the cycle.
                    if let i = path.firstIndex(of: e.to) { cyclic.formUnion(path[i...]) }
                    cyclic.insert(e.to)
                } else if !visited.contains(e.to) {
                    dfs(e.to, path + [e.to])
                }
            }
            onStack.remove(id)
        }
        for b in blocks where !visited.contains(b.id) { dfs(b.id, [b.id]) }
        return cyclic
    }

    /// Issues grouped by the block they pin to (whole-flow issues under `nil`),
    /// so the editor can mark each card and summarise the rest in one pass.
    func issuesByBlock() -> [String?: [FlowIssue]] {
        Dictionary(grouping: validate(), by: { $0.block })
    }
}

// MARK: - Saved flows (the library)

/// A lightweight pointer to a flow saved in the project's library. Identified by
/// its file URL; `title` is read from the saved JSON so the picker reads in plain
/// language rather than file names.
struct SavedFlowRef: Identifiable, Equatable {
    let url: URL
    let title: String
    var id: String { url.path }
    var fileName: String { url.deletingPathExtension().lastPathComponent }
}

// MARK: - Persistence (chunk 3: the flow is a file)

/// Persists the active flow as a readable JSON file under `<project>/.idealize/
/// flow.json`. Project-scoped on purpose, and this is the Conductor learning made
/// literal: a flow is part of the work, so it lives *with* the code — committable
/// and diffable in a pull request, not hidden in app state. The file is also the
/// contract between this editor and the `flow-review` skill: Claude reads and
/// writes the same path (it owns the `review` zone). With no project path we fall
/// back to Application Support so a plain-shell session still keeps its sketch.
///
/// Saves are debounced and the example seed is never written until the user
/// actually edits, so opening a project doesn't litter it with a `.idealize`
/// folder. JSON is pretty-printed with sorted keys so diffs stay legible.
@MainActor
final class FlowStore: ObservableObject {
    @Published var flow: Flow { didSet { if !suspendSave { scheduleSave() } } }
    private(set) var projectPath: String?
    /// True while we assign `flow` programmatically (load / project switch), so the
    /// `didSet` doesn't echo a freshly-loaded flow straight back to disk.
    private var suspendSave = false
    private var saveTask: Task<Void, Never>?

    init(projectPath: String? = nil) {
        self.projectPath = projectPath
        self.flow = Self.load(projectPath: projectPath) ?? .example
    }

    /// Re-point at a different project once the session learns its cwd. Flushes the
    /// current flow first, then loads that project's flow (or the example seed).
    func switchProject(_ path: String?) {
        let norm = (path?.isEmpty == true) ? nil : path
        guard norm != projectPath else { return }
        flushSave()
        projectPath = norm
        suspendSave = true
        flow = Self.load(projectPath: norm) ?? .example
        suspendSave = false
    }

    /// Where this project's flow lives. Creates the directory only when asked to
    /// (on write), so a read never has a side effect on the project tree.
    static func fileURL(for projectPath: String?, create: Bool) -> URL {
        let dir: URL
        if let p = projectPath, !p.isEmpty, p != "/" {
            dir = URL(fileURLWithPath: p).appendingPathComponent(".idealize")
        } else {
            dir = URL(fileURLWithPath: NSHomeDirectory())
                .appendingPathComponent("Library/Application Support/IDEalize")
        }
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir.appendingPathComponent("flow.json")
    }

    static func load(projectPath: String?) -> Flow? {
        let url = fileURL(for: projectPath, create: false)
        guard let data = try? Data(contentsOf: url),
              let flow = try? JSONDecoder().decode(Flow.self, from: data) else { return nil }
        return flow
    }

    /// Coalesce rapid edits (typing) into one write a beat after the last change.
    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = flow, path = projectPath
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            Self.write(snapshot, projectPath: path)
            _ = self
        }
    }

    /// Adopt Claude's `review` from disk after a review run, taking *only* that
    /// zone — the user's `title`/`flow` stay as they are in memory, so an edit
    /// made while the review ran is never clobbered (the ownership split, enforced
    /// on reload). Suspends save: this is Claude's write, already on disk.
    func reloadReview() {
        guard let disk = Self.load(projectPath: projectPath) else { return }
        suspendSave = true
        flow.review = disk.review
        suspendSave = false
    }

    /// Adopt Claude's `run` checkpoint from disk after a run turn (the symmetric
    /// counterpart to `reloadReview`). Takes *only* the run zone, so a flow edit
    /// made while the run was in flight is never clobbered. Once adopted, the run
    /// state rides along with the app's own saves, so it survives a relaunch and a
    /// stopped run can be resumed later.
    func reloadRun() {
        guard let disk = Self.load(projectPath: projectPath) else { return }
        suspendSave = true
        flow.run = disk.run
        suspendSave = false
    }

    /// The run that can be picked up where it left off, if any.
    var resumableRun: FlowRun? {
        guard let r = flow.run, r.isResumable else { return nil }
        return r
    }

    /// Forget any recorded progress, so the next send starts the flow from the top.
    func clearRun() { flow.run = nil }

    /// Write immediately (on project switch / view teardown), skipping the debounce.
    func flushSave() {
        saveTask?.cancel()
        saveTask = nil
        Self.write(flow, projectPath: projectPath)
    }

    static func write(_ flow: Flow, projectPath: String?) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]   // legible, stable diffs
        guard let data = try? enc.encode(flow) else { return }
        try? data.write(to: fileURL(for: projectPath, create: true))
    }

    // MARK: Library — named flows you can save and re-open

    /// The library directory: `<project>/.idealize/flows/` (sibling of the active
    /// `flow.json`), so saved flows live with the code just like the working flow.
    static func flowsDir(for projectPath: String?, create: Bool) -> URL {
        let dir = fileURL(for: projectPath, create: false)
            .deletingLastPathComponent()
            .appendingPathComponent("flows")
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir
    }

    /// Every saved flow in this project's library, titled from its JSON and sorted
    /// for the picker. A read never creates the directory.
    func savedFlows() -> [SavedFlowRef] {
        let dir = Self.flowsDir(for: projectPath, create: false)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let data = try? Data(contentsOf: url),
                  let f = try? JSONDecoder().decode(Flow.self, from: data) else { return nil }
            let title = f.title.trimmingCharacters(in: .whitespaces)
            return SavedFlowRef(url: url, title: title.isEmpty ? url.deletingPathExtension().lastPathComponent : title)
        }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    /// Save the working flow into the library under `name` (also adopted as the
    /// flow's title so the saved copy and the picker agree). The file name is a
    /// filesystem-safe slug of the name; re-saving the same name overwrites.
    @discardableResult
    func saveCurrent(named name: String) -> SavedFlowRef? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty ? (flow.title.isEmpty ? "Untitled flow" : flow.title) : trimmed
        let slug = title.replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        let dir = Self.flowsDir(for: projectPath, create: true)
        let url = dir.appendingPathComponent(slug + ".json")
        var copy = flow
        copy.title = title
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(copy), (try? data.write(to: url)) != nil else { return nil }
        flow.title = title   // keep the working flow in step with what was saved
        return SavedFlowRef(url: url, title: title)
    }

    /// Load a saved flow into the working flow (which debounce-saves to the active
    /// `flow.json`). The review is dropped — a re-opened flow starts unreviewed.
    func openSaved(_ ref: SavedFlowRef) {
        guard let data = try? Data(contentsOf: ref.url),
              var f = try? JSONDecoder().decode(Flow.self, from: data) else { return }
        f.review = nil
        flow = f
    }

    /// Remove a saved flow from the library. Does not touch the working flow.
    func deleteSaved(_ ref: SavedFlowRef) {
        try? FileManager.default.removeItem(at: ref.url)
    }
}

// MARK: - Example (chunk 1: static render target)

extension Flow {
    /// The section-2 example from the build spec, used to prove file→spine
    /// rendering before any editing or Claude wiring exists.
    static let example = Flow(
        title: "Email me about big deals",
        flow: .init(
            blocks: [
                FlowBlock(id: "b1", type: .start,    text: "When a new deal is marked closed-won", hint: nil),
                FlowBlock(id: "b2", type: .decision, text: "Is the deal value over £10,000?", hint: nil),
                FlowBlock(id: "b3", type: .tool,     text: "Send an email to me", hint: nil),
                FlowBlock(id: "b4", type: .end,      text: "Stop, do nothing", hint: nil),
                // The action branch terminates on its own End so every path has an
                // explicit stop — a complete flow, and one the pre-flight passes clean.
                FlowBlock(id: "b5", type: .end,      text: "Done", hint: nil),
            ],
            connections: [
                FlowConnection(from: "b1", to: "b2", label: nil),
                FlowConnection(from: "b2", to: "b3", label: "yes"),
                FlowConnection(from: "b2", to: "b4", label: "no"),
                FlowConnection(from: "b3", to: "b5", label: nil),
            ]
        ),
        review: nil
    )
}
