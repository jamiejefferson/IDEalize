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
    /// Library + version metadata. Optional so existing `flow.json` files decode
    /// unchanged; treated as empty when absent.
    var metadata: FlowMetadata?

    struct Graph: Codable, Equatable {
        var blocks: [FlowBlock]
        var connections: [FlowConnection]
        /// The conversation-built stage tree (optional so existing graphs decode).
        /// When present, it is the primary structure the Flows UI renders; blocks
        /// remain the canonical run-graph for `/flow-run` compatibility.
        var stages: [FlowStage]?
    }

    /// Metadata with defaults applied — never nil at the UI layer.
    var resolvedMetadata: FlowMetadata {
        get { metadata ?? FlowMetadata() }
        set { metadata = newValue }
    }
}

/// Library-facing metadata for a flow. All fields have defaults so a flow saved
/// before metadata existed still decodes and displays sensibly.
struct FlowMetadata: Codable, Equatable {
    var description: String = ""
    var createdBy: String = ""
    var lastEdited: String = ""        // ISO-8601, display-only for Phase 1
    var tags: [String] = []
    var version: Int = 1
}

/// A conversation-level stage in the workflow. Stages are how non-technical users
/// think about the job; the block graph underneath remains the run-time structure.
/// A stage can nest children for progressive refinement.
struct FlowStage: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var text: String
    var definitionOfDone: String
    var children: [FlowStage]?

    init(id: String, title: String, text: String = "", definitionOfDone: String = "", children: [FlowStage]? = nil) {
        self.id = id
        self.title = title
        self.text = text
        self.definitionOfDone = definitionOfDone
        self.children = children
    }
}

/// A snapshot of a flow at a point in time, used for version history.
struct FlowVersion: Codable, Equatable, Identifiable {
    var id: String
    var createdAt: String              // ISO-8601
    var note: String
    var snapshot: Flow
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

// MARK: - Stage ↔ block graph bridging

extension Flow.Graph {
    /// Derive a simple, flat stage list from the existing block graph for the
    /// Flows timeline. Used when an older flow (blocks only) is opened.
    func stagesFromBlocks() -> [FlowStage] {
        blocks.map { block in
            FlowStage(
                id: block.id,
                title: block.type.label,
                text: block.text,
                definitionOfDone: block.type == .end ? "This path ends here." : "",
                children: nil
            )
        }
    }

    /// Convert a stage tree into a plain block graph so `/flow-run` can execute it.
    /// The result is a linear spine: start → one block per stage → end.
    /// Branches/conditions are flattened into the stage text for now; the AI
    /// interview can refine them later.
    static func blocksFromStages(_ stages: [FlowStage], title: String) -> (blocks: [FlowBlock], connections: [FlowConnection]) {
        var blocks: [FlowBlock] = []
        var connections: [FlowConnection] = []
        var previousID: String?

        // Flatten nested stages depth-first so children become sequential steps.
        func flatten(_ stage: FlowStage, into out: inout [FlowStage]) {
            out.append(stage)
            if let children = stage.children {
                for child in children { flatten(child, into: &out) }
            }
        }
        var flat: [FlowStage] = []
        for stage in stages { flatten(stage, into: &flat) }

        guard !flat.isEmpty else { return ([], []) }

        let startID = "b1"
        blocks.append(FlowBlock(id: startID, type: .start, text: title, hint: nil))
        previousID = startID

        for (index, stage) in flat.enumerated() {
            let id = "b\(index + 2)"
            let text = stage.text.isEmpty ? stage.title : "\(stage.title) — \(stage.text)"
            blocks.append(FlowBlock(id: id, type: .tool, text: text, hint: nil))
            connections.append(FlowConnection(from: previousID!, to: id, label: nil))
            previousID = id
        }

        let endID = "b\(flat.count + 2)"
        blocks.append(FlowBlock(id: endID, type: .end, text: "Done", hint: nil))
        connections.append(FlowConnection(from: previousID!, to: endID, label: nil))

        return (blocks, connections)
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

/// Persists the active flow as a readable JSON file at a single GLOBAL path,
/// `~/Library/Application Support/IDEalize/flow.json` — independent of any
/// project, exactly like a skill. The flow you're sketching is the same flow in
/// every session and every tab; switching projects never swaps it. (Where a flow
/// *runs* is still the active terminal's working directory — but where it *lives*
/// is global.) This file is also the contract with the `flow-run`/`flow-review`
/// skills, which read and write the same global path (Claude owns `review`/`run`).
///
/// Saves are debounced; JSON is pretty-printed with sorted keys so diffs stay
/// legible.
@MainActor
final class FlowStore: ObservableObject {
    /// The single store every chat box observes. `flow.json` is one global file,
    /// so per-pane stores silently overwrote each other (last debounced save won);
    /// one shared instance keeps every pane on the same in-memory flow.
    static let shared = FlowStore()

    @Published var flow: Flow { didSet { if !suspendSave { scheduleSave() } } }
    /// True while we assign `flow` programmatically (initial load / opening a saved
    /// flow), so the `didSet` doesn't echo it straight back to disk.
    private var suspendSave = false
    private var saveTask: Task<Void, Never>?

    init() {
        self.flow = Self.load() ?? .example
        Self.migrateLegacyLibrary()
    }

    /// The single global home of the active flow. Creates the directory only when
    /// asked to (on write), so a read never has a side effect.
    static func activeFileURL(create: Bool) -> URL {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize")
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir.appendingPathComponent("flow.json")
    }

    static func load() -> Flow? {
        let url = activeFileURL(create: false)
        if let flow = decode(url) { return flow }
        // A corrupt or half-written flow.json falls back to the last good backup
        // before giving up — without this, the next save would write `.example`
        // straight over the user's flow.
        let bak = url.appendingPathExtension("bak")
        if let flow = decode(bak) {
            NSLog("IDEalize: flow.json unreadable; restored from backup")
            return flow
        }
        return nil
    }

    private static func decode(_ url: URL) -> Flow? {
        guard let data = try? Data(contentsOf: url),
              let flow = try? JSONDecoder().decode(Flow.self, from: data) else { return nil }
        return flow
    }

    /// Coalesce rapid edits (typing) into one write a beat after the last change.
    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = flow
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            Self.write(snapshot)
            _ = self
        }
    }

    /// Adopt Claude's `review` from disk after a review run, taking *only* that
    /// zone — the user's `title`/`flow` stay as they are in memory, so an edit
    /// made while the review ran is never clobbered (the ownership split, enforced
    /// on reload). Suspends save: this is Claude's write, already on disk.
    func reloadReview() {
        guard let disk = Self.load() else { return }
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
        guard let disk = Self.load() else { return }
        suspendSave = true
        flow.run = disk.run
        suspendSave = false
    }

    /// Adopt Claude's improvements after a `flow-improve` turn. Unlike review/run,
    /// this turn rewrote the user's own zones (`title` + `flow`) and refreshed the
    /// `review`, so we take all three from disk; `run` stays as it is in memory.
    /// The editor is closed while Claude works, so there's no in-flight user edit
    /// to clobber — this is the one place Claude's `flow` write is adopted.
    func reloadImproved() {
        guard let disk = Self.load() else { return }
        suspendSave = true
        flow.title = disk.title
        flow.flow = disk.flow
        flow.review = disk.review
        suspendSave = false
    }

    /// The run that can be picked up where it left off, if any.
    var resumableRun: FlowRun? {
        guard let r = flow.run, r.isResumable else { return nil }
        return r
    }

    /// Forget any recorded progress, so the next send starts the flow from the top.
    func clearRun() { flow.run = nil }

    /// Write immediately (on view teardown), skipping the debounce.
    func flushSave() {
        saveTask?.cancel()
        saveTask = nil
        Self.write(flow)
    }

    static func write(_ flow: Flow) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]   // legible, stable diffs
        guard let data = try? enc.encode(flow) else { return }
        let url = activeFileURL(create: true)
        // Keep the previous good file as flow.json.bak before overwriting, and
        // write atomically so a crash mid-write can never leave a torn file.
        if FileManager.default.fileExists(atPath: url.path) {
            let bak = url.appendingPathExtension("bak")
            try? FileManager.default.removeItem(at: bak)
            try? FileManager.default.copyItem(at: url, to: bak)
        }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("IDEalize: failed to write flow.json: \(error.localizedDescription)")
        }
    }

    // MARK: Library — named flows you can save and re-open

    /// The library directory — GLOBAL, shared across every project, sat beside the
    /// active `flow.json` in Application Support. A saved flow is a reusable
    /// building block available everywhere, like a skill — never tied to one repo.
    static func flowsDir(create: Bool) -> URL {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize/flows")
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir
    }

    /// One-time fold-in: earlier builds saved the library per-project under
    /// `<project>/.idealize/flows`. Flows are global now, so lift any flows found in
    /// the legacy home library (`~/.idealize/flows`, where home-scoped sessions
    /// saved them) into the shared library. Idempotent: files already present (by
    /// name) are left untouched, and it runs at most once per launch.
    private static var didMigrateLibrary = false
    static func migrateLegacyLibrary() {
        guard !didMigrateLibrary else { return }
        didMigrateLibrary = true
        let fm = FileManager.default
        let legacy = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".idealize/flows")
        guard let files = try? fm.contentsOfDirectory(at: legacy, includingPropertiesForKeys: nil) else { return }
        let jsons = files.filter { $0.pathExtension == "json" }
        guard !jsons.isEmpty else { return }
        let global = flowsDir(create: true)
        for src in jsons {
            let dst = global.appendingPathComponent(src.lastPathComponent)
            if !fm.fileExists(atPath: dst.path) { try? fm.copyItem(at: src, to: dst) }
        }
    }

    /// Every saved flow in the global library, titled from its JSON and sorted for
    /// the picker. A read never creates the directory.
    func savedFlows() -> [SavedFlowRef] {
        let dir = Self.flowsDir(create: false)
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
        let dir = Self.flowsDir(create: true)
        let url = dir.appendingPathComponent(slug + ".json")
        var copy = flow
        copy.title = title
        // Stamp the save in the metadata so the library can sort/filter by it.
        copy.resolvedMetadata.lastEdited = ISO8601DateFormatter().string(from: Date())
        copy.resolvedMetadata.version += 1
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(copy), (try? data.write(to: url)) != nil else { return nil }
        flow.title = title   // keep the working flow in step with what was saved
        flow.resolvedMetadata = copy.resolvedMetadata
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

    /// Duplicate a saved flow into the library under a new name. The copy starts
    /// at version 1 with "(copy)" appended to its title.
    @discardableResult
    func duplicateSaved(_ ref: SavedFlowRef) -> SavedFlowRef? {
        guard let data = try? Data(contentsOf: ref.url),
              var copy = try? JSONDecoder().decode(Flow.self, from: data) else { return nil }
        copy.title = "\(copy.title) copy"
        copy.resolvedMetadata.version = 1
        copy.resolvedMetadata.lastEdited = ISO8601DateFormatter().string(from: Date())
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let newData = try? encoder.encode(copy) else { return nil }
        let dir = Self.flowsDir(create: true)
        let base = ref.url.deletingPathExtension().lastPathComponent
        var url = dir.appendingPathComponent("\(base)-copy.json")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent("\(base)-copy-\(n).json")
            n += 1
        }
        guard (try? newData.write(to: url)) != nil else { return nil }
        return SavedFlowRef(url: url, title: copy.title)
    }

    /// Move a saved flow into the archive folder beside the library. The flow is
    /// no longer listed in the main library but is preserved on disk.
    func archiveSaved(_ ref: SavedFlowRef) {
        let archiveDir = Self.flowsDir(create: true)
            .deletingLastPathComponent()
            .appendingPathComponent("flows-archive")
        try? FileManager.default.createDirectory(at: archiveDir, withIntermediateDirectories: true)
        let dest = archiveDir.appendingPathComponent(ref.url.lastPathComponent)
        try? FileManager.default.moveItem(at: ref.url, to: dest)
    }

    // MARK: Version history — snapshots of significant edits

    /// Where numbered flow snapshots live, beside the library.
    static func versionsDir(create: Bool) -> URL {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize/flows-versions")
        if create { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir
    }

    /// Capture the current flow as a new version. Called on significant edits
    /// (stage confirmed, suggestion accepted, explicit save).
    @discardableResult
    func saveVersion(note: String) -> FlowVersion {
        let fmt = ISO8601DateFormatter()
        let now = fmt.string(from: Date())
        let id = UUID().uuidString
        var snapshot = flow
        snapshot.resolvedMetadata.version = (snapshot.metadata?.version ?? 0) + 1
        snapshot.resolvedMetadata.lastEdited = now
        let version = FlowVersion(id: id, createdAt: now, note: note, snapshot: snapshot)
        let url = Self.versionsDir(create: true).appendingPathComponent(id + ".json")
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(version) { try? data.write(to: url) }
        // Keep the working flow's version counter in step.
        flow.resolvedMetadata = snapshot.resolvedMetadata
        return version
    }

    /// All saved versions, newest first.
    func versions() -> [FlowVersion] {
        let dir = Self.versionsDir(create: false)
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return [] }
        return files.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let data = try? Data(contentsOf: url),
                  let v = try? JSONDecoder().decode(FlowVersion.self, from: data) else { return nil }
            return v
        }.sorted { $0.createdAt > $1.createdAt }
    }

    /// Restore a previous version as the working flow. The restored snapshot keeps
    /// its own metadata (including its version number).
    func restore(version: FlowVersion) {
        flow = version.snapshot
    }

    /// Remove a version snapshot.
    func deleteVersion(id: String) {
        let url = Self.versionsDir(create: false).appendingPathComponent(id + ".json")
        try? FileManager.default.removeItem(at: url)
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
