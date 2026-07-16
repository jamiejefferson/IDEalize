import SwiftUI

/// Chunk 2: the editable spine. Same top-to-bottom column as `FlowSpineView`,
/// but every card is live — edit its text, change its type, splice a step after
/// it, fork a branch off it, or delete it. All edits go through `Flow.Graph`'s
/// mutation helpers (by stable id); this view never touches connections, it asks
/// the graph to rewire and lets `spine()` re-derive the layout. No coordinates.
struct FlowEditorView: View {
    @Binding var flow: Flow
    /// Fires the deterministic→Claude review (defined in the panel). The pre-flight
    /// gates it: errors disable the button, so no Claude turn is spent on a flow
    /// that can't run.
    var onReview: () -> Void = {}
    /// True while Claude is reviewing — swaps the button for a spinner.
    var reviewing: Bool = false
    /// Ask Claude to apply its review suggestions to the flow (the `flow-improve`
    /// command). Surfaced on the review banner whenever there are notes to act on.
    var onImprove: () -> Void = {}
    /// True while Claude is applying improvements — swaps the button for a spinner.
    var improving: Bool = false
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    /// Claude's review notes grouped by the block they pin to, threaded down to
    /// the cards alongside the deterministic pre-flight issues.
    private var notesByBlock: [String: [FlowReview.Note]] {
        Dictionary(grouping: flow.review?.notes ?? [], by: { $0.block })
    }

    /// Where each step stands in the current run, used to badge the cards. Empty
    /// when the flow has never run.
    private var runStateByBlock: [String: BlockRunState] { flow.runStateByBlock() }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            titleField
            if let run = flow.run {
                RunStatusBanner(run: run, total: flow.flow.blocks.count) { flow.run = nil }
            }
            if let review = flow.review {
                ReviewBanner(review: review, improving: improving, onImprove: onImprove)
            }
            if flow.flow.blocks.isEmpty {
                emptyState
            } else {
                EditableSpineColumn(flow: $flow, rows: flow.flow.spine(),
                                    reachable: flow.flow.reachableIDs(),
                                    issuesByBlock: flow.flow.issuesByBlock(),
                                    notesByBlock: notesByBlock,
                                    runStateByBlock: runStateByBlock, topLevel: true)
            }
            addStepButton
            if !flow.flow.blocks.isEmpty {
                PreflightBar(issues: flow.flow.validate(), reviewing: reviewing, onReview: onReview)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Shown when the flow has no blocks yet. A blank column reads as broken; this
    /// frames it as a starting point and points at the add button below.
    private var emptyState: some View {
        HStack(spacing: 9) {
            Image(systemName: "wand.and.stars").font(.system(size: 13))
            Text("Sketch a flow — add your first step to begin.")
                .font(settings.ui(12))
        }
        .foregroundStyle(Color(theme.secondaryForeground))
        .padding(.horizontal, 14).padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10)
            .fill(Color(theme.surface).opacity(0.4)))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .strokeBorder(Color(theme.border).opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("FLOW")
                .font(settings.ui(9, .semibold)).tracking(0.7)
                .foregroundStyle(Color(theme.secondaryForeground))
            TextField("Name this flow…", text: $flow.title)
                .textFieldStyle(.plain)
                .font(settings.ui(16, .semibold))
                .foregroundStyle(Color(theme.foreground))
        }
    }

    /// Appends a fresh step at the end of the main column.
    private var addStepButton: some View {
        Button(action: addStep) {
            HStack(spacing: 7) {
                Image(systemName: "plus.circle.fill").font(.system(size: 13))
                Text("Add a step").font(settings.ui(12, .medium))
            }
            .foregroundStyle(settings.actionStyle.color)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Capsule().fill(settings.actionStyle.color.opacity(0.12)))
            .overlay(Capsule().strokeBorder(settings.actionStyle.color.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help("Add a step to the end of the flow")
        .padding(.leading, 18)
    }

    private func addStep() {
        if let tail = flow.flow.tailID() {
            flow.flow.insert(after: tail)
        } else {
            // Empty graph: seed a first block directly.
            let id = flow.flow.nextBlockID()
            flow.flow.blocks.append(FlowBlock(id: id, type: .start, text: "", hint: nil))
        }
    }
}

/// A column of editable spine rows. Recurses into a fork's branches, exactly
/// like the read-only `SpineColumn`, but threads the `flow` binding down so deep
/// cards mutate the same graph.
private struct EditableSpineColumn: View {
    @Binding var flow: Flow
    let rows: [SpineRow]
    /// Ids reachable from the start block. Only consulted at the top level, where
    /// `spine()` backfills orphan roots after the connected spine; a row here that
    /// isn't reachable is a disconnected root and gets the "not connected" badge.
    var reachable: Set<String> = []
    /// Deterministic pre-flight issues grouped by block id, threaded down so each
    /// card can mark itself. Computed once per render in `FlowEditorView`.
    var issuesByBlock: [String?: [FlowIssue]] = [:]
    /// Claude's review notes grouped by block id — the semantic layer that renders
    /// beneath the pre-flight issues on each card.
    var notesByBlock: [String: [FlowReview.Note]] = [:]
    /// Each block's standing in the current run (done/current/pending), threaded
    /// down so every card — including those inside branches — can badge itself.
    var runStateByBlock: [String: BlockRunState] = [:]
    var topLevel: Bool = false
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                let disconnected = topLevel && !reachable.contains(row.block.id)
                if disconnected, index > 0 { disconnectedDivider }
                EditableStepCard(flow: $flow, block: row.block, disconnected: disconnected,
                                 issues: issuesByBlock[row.block.id] ?? [],
                                 notes: notesByBlock[row.block.id] ?? [],
                                 runState: runStateByBlock[row.block.id])
                if row.branches.isEmpty {
                    if index < rows.count - 1 && !nextIsDisconnected(index) { connector }
                } else {
                    connector
                    branchRow(row.branches)
                }
            }
        }
    }

    /// True if the row after `index` is a disconnected root — used to suppress the
    /// connector line so an orphan doesn't read as wired to the spine above it.
    private func nextIsDisconnected(_ index: Int) -> Bool {
        guard topLevel, index + 1 < rows.count else { return false }
        return !reachable.contains(rows[index + 1].block.id)
    }

    /// A labelled gap that separates orphan roots from the connected spine, so the
    /// jump from "wired column" to "loose block" is legible rather than abrupt.
    private var disconnectedDivider: some View {
        HStack(spacing: 7) {
            Image(systemName: "scissors").font(.system(size: 9))
            Text("NOT CONNECTED").font(settings.ui(8, .semibold)).tracking(0.6)
            Rectangle().fill(Color(theme.border).opacity(0.5)).frame(height: 1)
        }
        .foregroundStyle(Color(theme.secondaryForeground).opacity(0.8))
        .padding(.vertical, 10)
    }

    private func branchRow(_ branches: [SpineBranch]) -> some View {
        HStack(alignment: .top, spacing: 16) {
            ForEach(branches) { branch in
                VStack(alignment: .leading, spacing: 6) {
                    branchLabel(branch)
                    EditableSpineColumn(flow: $flow, rows: branch.rows,
                                        issuesByBlock: issuesByBlock, notesByBlock: notesByBlock,
                                        runStateByBlock: runStateByBlock)
                        // A branch's rows are reachable via their fork parent, so
                        // they are never disconnected — no flagging inside branches.
                }
                .padding(.leading, 18)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Color(theme.border).opacity(0.6))
                        .frame(width: 1.5)
                }
            }
        }
        .padding(.leading, 10)
    }

    /// An editable branch label ("yes"/"no"). Editing rewrites the connection's
    /// label by its from→to endpoints, which a branch carries via its first row.
    @ViewBuilder private func branchLabel(_ branch: SpineBranch) -> some View {
        if let from = forkParent(of: branch), let to = branch.rows.first?.block.id {
            TextField("label", text: Binding(
                get: { flow.flow.connections.first { $0.from == from && $0.to == to }?.label ?? "" },
                set: { flow.flow.setBranchLabel(from: from, to: to, label: $0) }
            ))
            .textFieldStyle(.plain)
            .multilineTextAlignment(.center)
            .font(settings.ui(10, .semibold))
            .foregroundStyle(settings.actionStyle.color)
            .frame(minWidth: 28)
            .fixedSize()
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Capsule().fill(settings.actionStyle.color.opacity(0.14)))
            .overlay(Capsule().strokeBorder(settings.actionStyle.color.opacity(0.35), lineWidth: 1))
        }
    }

    /// The block this branch hangs off — the unique `from` whose edge lands on
    /// the branch's first block.
    private func forkParent(of branch: SpineBranch) -> String? {
        guard let to = branch.rows.first?.block.id else { return nil }
        return flow.flow.connections.first { $0.to == to }?.from
    }

    private var connector: some View {
        Capsule()
            .fill(Color(theme.border).opacity(0.7))
            .frame(width: 2, height: 16)
            .padding(.leading, 18)
    }
}

/// One editable block. Inline text field, a type-picker menu on the badge, and a
/// hover-revealed control cluster: splice a step after (linear only), fork a
/// branch, or delete. Mirrors `FlowStepCard`'s look so the editor and the
/// read-only render sit together.
private struct EditableStepCard: View {
    @Binding var flow: Flow
    let block: FlowBlock
    /// A root unreachable from the start block (an orphan left by deleting a fork).
    /// Drawn dimmed with a dashed border so it reads as loose, not part of the run.
    var disconnected: Bool = false
    /// Deterministic pre-flight issues pinned to this block (see `Flow.validate`).
    var issues: [FlowIssue] = []
    /// Claude's semantic review notes pinned to this block (its `review` zone).
    var notes: [FlowReview.Note] = []
    /// This step's standing in the current run, or `nil` if the flow hasn't run.
    var runState: BlockRunState? = nil
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    private var theme: Theme { settings.theme }
    private var size: CGFloat { settings.chatFontSize }

    /// The most severe issue on this block drives its marker — an error edges out
    /// a warning. `nil` means the block is structurally clean.
    private var topIssue: FlowIssue? {
        issues.first { $0.severity == .error } ?? issues.first
    }

    private var accent: Color {
        if disconnected { return Color(theme.secondaryForeground) }
        switch block.type {
        case .start: return .green
        case .decision: return settings.actionStyle.color
        case .tool: return Color(theme.accent)
        case .end: return Color(theme.secondaryForeground)
        }
    }

    /// Out-degree decides whether "insert after" is meaningful: splicing only
    /// makes sense on a linear block (a fork branches via the + branch control).
    private var isLinear: Bool { flow.flow.connections.filter { $0.from == block.id }.count <= 1 }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            typeBadge
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(block.type.label.uppercased())
                        .font(settings.ui(9, .semibold)).tracking(0.7)
                        .foregroundStyle(Color(theme.secondaryForeground))
                    if let rs = runState { runBadge(rs) }
                }
                TextField(block.hint ?? "Describe this step…", text: textBinding, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(settings.ui(size - 1))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(1...6)
                if let issue = topIssue { issueChip(issue) }
                ForEach(notes) { noteChip($0) }
            }
            Spacer(minLength: 0)
            controls.opacity(hovering ? 1 : 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A pending step (run not yet reached it) reads back; done/current sit full.
        .opacity(disconnected ? 0.6 : (runState == .pending ? 0.5 : 1))
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(theme.surface).opacity(0.7)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(
            strokeColor.opacity(topIssue?.severity == .error ? 0.6 : 0.35),
            style: StrokeStyle(lineWidth: 1, dash: disconnected ? [4, 3] : [])))
        // The step the run is on (or would resume at) gets a clear green ring.
        .overlay(RoundedRectangle(cornerRadius: 10)
            .strokeBorder(runState == .current ? Color.green.opacity(0.85) : .clear, lineWidth: 1.6))
        .onHover { hovering = $0 }
    }

    /// A small marker showing where this step stands in the run: a green tick when
    /// done, a green "now" pip for the current/resume step, nothing for pending
    /// (the card's dimmed state already says it).
    @ViewBuilder private func runBadge(_ state: BlockRunState) -> some View {
        switch state {
        case .done:
            HStack(spacing: 3) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 9))
                Text("done").font(settings.ui(8, .semibold)).tracking(0.5)
            }
            .foregroundStyle(.green)
        case .current:
            HStack(spacing: 3) {
                Image(systemName: "arrowtriangle.right.circle.fill").font(.system(size: 9))
                Text("now").font(settings.ui(8, .semibold)).tracking(0.5)
            }
            .foregroundStyle(.green)
        case .pending:
            EmptyView()
        }
    }

    /// Border tint: a structural error edges out the type accent so a broken card
    /// reads as broken at a glance; warnings keep the calm accent.
    private var strokeColor: Color {
        topIssue?.severity == .error ? .red : accent
    }

    /// A one-line marker for the worst issue on this card. The fix rides in the
    /// tooltip so the chip stays terse. Warnings are amber; errors red.
    private func issueChip(_ issue: FlowIssue) -> some View {
        let tint: Color = issue.severity == .error ? .red : .orange
        return HStack(spacing: 5) {
            Image(systemName: issue.severity == .error ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 9))
            Text(issue.message).font(settings.ui(10, .medium))
        }
        .foregroundStyle(tint)
        .help(issue.fix)
        .padding(.top, 1)
    }

    /// One of Claude's review notes for this card: the issue inline, the suggested
    /// fix in the tooltip. Tinted with the action colour to read as Claude's voice,
    /// distinct from the red/amber of the deterministic pre-flight.
    private func noteChip(_ note: FlowReview.Note) -> some View {
        HStack(alignment: .top, spacing: 5) {
            Image(systemName: "sparkles").font(.system(size: 9)).padding(.top, 1)
            Text(note.issue).font(settings.ui(10, .medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(settings.actionStyle.color)
        .help(note.suggestion)
        .padding(.top, 1)
    }

    /// The type badge doubles as a picker — click to recast the step.
    private var typeBadge: some View {
        Menu {
            ForEach(FlowBlockType.allCases, id: \.self) { t in
                Button { flow.flow.setType(block.id, t) } label: {
                    Label(t.label, systemImage: t.icon)
                }
            }
        } label: {
            // Interactive (this badge is a click-to-recast menu), so the icon takes
            // the highlight — the actual `.fill` the user sees on the send button
            // (solid or gradient), not `.color`, which falls back to the washed-out
            // terminal accent when the highlight is a gradient. Type still reads from
            // the icon's shape, its label, and the card's accent border.
            Image(systemName: block.type.icon)
                .font(.system(size: size))
                .foregroundStyle(settings.actionStyle.fill)
                .frame(width: 22)
                .padding(.top, 1)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Change step type")
    }

    private var controls: some View {
        HStack(spacing: 6) {
            if isLinear {
                iconButton("plus.circle", "Add a step after this") {
                    flow.flow.insert(after: block.id)
                }
            }
            iconButton("arrow.triangle.branch", "Fork a branch from here") {
                let n = flow.flow.connections.filter { $0.from == block.id }.count
                flow.flow.addBranch(from: block.id, label: n == 0 ? "yes" : (n == 1 ? "no" : "branch \(n + 1)"))
            }
            iconButton("trash", "Delete this step", tint: .red) {
                flow.flow.delete(block.id)
            }
        }
    }

    private func iconButton(_ symbol: String, _ help: String, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12))
                .foregroundStyle(tint ?? Color(theme.secondaryForeground))
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color(theme.surface)))
                .overlay(Circle().strokeBorder(Color(theme.border), lineWidth: 1))
        }
        .buttonStyle(.raisedIconHover)
        .help(help)
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { flow.flow.blocks.first { $0.id == block.id }?.text ?? "" },
            set: { flow.flow.setText(block.id, $0) }
        )
    }
}

/// The deterministic pre-flight, surfaced. This is the zero-token gate that sits
/// *before* Claude's review (the learning taken from Conductor: the validation
/// layer is LLM-free). It reports one of three states — clean, warnings only, or
/// errors — and is what a future "Review with Claude" / "Run" button keys off:
/// errors block the send entirely, so no Claude turn is ever spent on a flow that
/// can't run. Warnings are advisory and don't block.
private struct PreflightBar: View {
    let issues: [FlowIssue]
    var reviewing: Bool = false
    var onReview: () -> Void = {}
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    private var errors: Int { issues.filter { $0.severity == .error }.count }
    private var warnings: Int { issues.filter { $0.severity == .warning }.count }
    /// The gate: a clean-enough structure (no hard errors) is the only thing that
    /// may be sent to Claude. This is the zero-token saving — errors never reach a
    /// turn.
    private var canReview: Bool { errors == 0 }

    var body: some View {
        let (icon, tint, headline) = state
        return HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(tint)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(headline).font(settings.ui(11, .semibold)).foregroundStyle(Color(theme.foreground))
                if !issues.isEmpty {
                    Text(issues.prefix(3).map(\.fix).joined(separator: "  ·  "))
                        .font(settings.ui(10))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            reviewButton
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }

    /// "Review with Claude" — disabled (and dimmed) while errors remain or a review
    /// is already in flight. Mirrors the action-colour pills elsewhere in the chat.
    private var reviewButton: some View {
        Button(action: onReview) {
            HStack(spacing: 6) {
                if reviewing {
                    ProgressView().controlSize(.small).tint(.white)
                    Text("Reviewing…")
                } else {
                    Image(systemName: "sparkles").font(.system(size: 11))
                    Text("Review with Claude")
                }
            }
            .font(settings.ui(11, .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(Capsule().fill(canReview ? AnyShapeStyle(settings.actionStyle.fill)
                                                  : AnyShapeStyle(Color(theme.secondaryForeground).opacity(0.4))))
        }
        .buttonStyle(.plain)
        .disabled(!canReview || reviewing)
        .help(canReview ? "Send this flow to Claude for a review"
                        : "Fix the structural problems above first")
    }

    /// Errors win over warnings win over clean — the bar reflects the blocking
    /// state first, since that is what gates the send.
    private var state: (icon: String, tint: Color, headline: String) {
        if errors > 0 {
            return ("exclamationmark.octagon.fill", .red,
                    "\(errors) thing\(errors == 1 ? "" : "s") to fix before this can run")
        }
        if warnings > 0 {
            return ("exclamationmark.triangle.fill", .orange,
                    "Ready to review — \(warnings) suggestion\(warnings == 1 ? "" : "s")")
        }
        return ("checkmark.seal.fill", .green, "Structure looks good — ready for Claude to review")
    }
}

/// The run's standing, rendered at the top of the editor when a flow has been run
/// (or stopped partway). Reports progress and — crucially — that a stopped run can
/// be picked up: the send arrow below becomes "Resume". "Start over" forgets the
/// recorded progress so the next send runs from the top.
private struct RunStatusBanner: View {
    let run: FlowRun
    let total: Int
    var onReset: () -> Void = {}
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    private var done: Int { run.completed.count }

    private var state: (icon: String, tint: Color, headline: String) {
        switch run.status {
        case .done:
            return ("checkmark.seal.fill", .green, "Flow complete — all \(total) steps ran")
        case .failed:
            return ("exclamationmark.octagon.fill", .red, "Stopped — couldn't finish step \(done + 1)")
        case .paused:
            return ("pause.circle.fill", .orange, "Paused after \(done) of \(total) — send to resume")
        case .running:
            return ("arrow.triangle.branch", .orange, "In progress — \(done) of \(total) done, send to resume")
        }
    }

    var body: some View {
        let (icon, tint, headline) = state
        return HStack(alignment: .top, spacing: 9) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(tint).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(headline).font(settings.ui(11, .semibold)).foregroundStyle(Color(theme.foreground))
                if let last = run.completed.last?.result, !last.isEmpty {
                    Text(last).font(settings.ui(10))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Button(action: onReset) {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.counterclockwise").font(.system(size: 10))
                    Text("Start over").font(settings.ui(10, .medium))
                }
                .foregroundStyle(Color(theme.secondaryForeground))
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(Capsule().fill(Color(theme.surface)))
                .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .help("Forget this progress and run from the start next time")
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}

/// Claude's verdict, rendered at the top of the editor. The semantic counterpart
/// to the deterministic `PreflightBar`: where the pre-flight judges *structure*,
/// this is Claude's read on *meaning*. `ready` is green; `needs-work` is amber and
/// points at the per-card notes below. Only shown once a review has run. Running
/// the flow is the input's send arrow — this banner just reports Claude's read.
private struct ReviewBanner: View {
    let review: FlowReview
    var improving: Bool = false
    var onImprove: () -> Void = {}
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    private var ready: Bool { review.verdict == .ready }
    private var tint: Color { ready ? .green : .orange }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: ready ? "checkmark.seal.fill" : "sparkles")
                    .font(.system(size: 13)).foregroundStyle(tint).padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(ready ? "Claude says this is ready — send it with the arrow below" : "Claude left some suggestions")
                        .font(settings.ui(11, .semibold)).foregroundStyle(Color(theme.foreground))
                    Text(review.summary)
                        .font(settings.ui(11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .fixedSize(horizontal: false, vertical: true)
                    if !review.notes.isEmpty {
                        Text("\(review.notes.count) note\(review.notes.count == 1 ? "" : "s") on the steps below.")
                            .font(settings.ui(10)).foregroundStyle(tint)
                    }
                }
                Spacer(minLength: 0)
            }
            // Hand the suggestions back to Claude to apply — the missing half of the
            // review loop. Only when there's something to act on.
            if !review.notes.isEmpty { improveButton }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }

    /// "Make these improvements" — asks Claude to apply its own notes to the steps.
    private var improveButton: some View {
        Button(action: onImprove) {
            HStack(spacing: 6) {
                if improving {
                    ProgressView().controlSize(.small).tint(.white)
                    Text("Making improvements…")
                } else {
                    Image(systemName: "wand.and.stars").font(.system(size: 11))
                    Text("Make these improvements")
                }
            }
            .font(settings.ui(11, .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(settings.actionStyle.fill))
        }
        .buttonStyle(.plain)
        .disabled(improving)
        .help("Ask Claude to apply its suggestions to your steps")
    }
}
