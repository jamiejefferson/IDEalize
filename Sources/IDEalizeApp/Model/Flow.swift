import Foundation

/// A user-sketched flow: a job broken into simple steps. This file is the single
/// source of truth — the UI derives all layout from block order and connections.
/// There are NO coordinates anywhere in the data; Claude reads and writes the
/// file, never the pixels.
///
/// Ownership zones (load-bearing): the UI owns `title` and `flow`; Claude owns
/// `review`. Neither writes the other's zone. On send the UI writes `flow`; on
/// return Claude writes `review`. Absence of `review` is the default state and
/// keeps the run button disabled.
struct Flow: Codable, Equatable {
    var title: String
    var flow: Graph
    /// Written only by Claude (the `flow-review` skill). `nil` until a review runs.
    var review: FlowReview?

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
    let label: String
    let rows: [SpineRow]
    var id: String { label.isEmpty ? UUID().uuidString : label }
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
        return buildColumn(from: root.id, visited: &visited)
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
                    branches.append(SpineBranch(label: conn.label ?? "", rows: sub))
                }
                rows.append(SpineRow(block: blk, branches: branches))
                current = nil   // the column ends at the fork
            }
        }
        return rows
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
            ],
            connections: [
                FlowConnection(from: "b1", to: "b2", label: nil),
                FlowConnection(from: "b2", to: "b3", label: "yes"),
                FlowConnection(from: "b2", to: "b4", label: "no"),
            ]
        ),
        review: nil
    )
}
