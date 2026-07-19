import Foundation

/// One turn in the guided interview. `options` is non-empty for confirmation
/// cards ("Yes / Change / Remove") or when the engine is offering suggestions
/// instead of an open question.
struct InterviewTurn: Identifiable, Equatable, Codable {
    enum Speaker: String, Codable { case ai, user }
    var id = UUID()
    let speaker: Speaker
    var text: String
    var options: [String] = []
    /// The stage this turn is about, if any (used for confirmation cards).
    var stage: FlowStage?
}

/// A deterministic, scriptable interview engine that builds a workflow by asking
/// plain-language questions. It is model-agnostic: it never talks to an AI, it
/// simply drives the conversation state machine. Phase 2 can swap this for an
/// AI-backed engine without changing the UI.
@MainActor
final class FlowsInterview: ObservableObject {
    /// The full conversation, oldest first. The UI renders this directly.
    @Published private(set) var turns: [InterviewTurn] = []
    /// Stages confirmed so far, in order. These are what the timeline shows.
    @Published private(set) var stages: [FlowStage] = []
    /// The overall outcome the user is trying to achieve.
    @Published private(set) var outcome: String = ""
    /// What "done" looks like for the whole flow.
    @Published private(set) var successCriteria: String = ""
    /// The stage currently being proposed/confirmed.
    @Published private(set) var pendingStage: FlowStage?
    /// The text of the current question, used for the input placeholder.
    @Published private(set) var currentPrompt: String = ""

    /// The current interview state, exposed so the session protocol can record it.
    var stateDescription: String { String(describing: state) }

    private enum State {
        case awaitingOutcome
        case awaitingSuccessCriteria
        case awaitingPeople
        case proposingStage
        case awaitingStageConfirmation
        case awaitingStageName
        case awaitingStageDetail
        case awaitingDefinitionOfDone
        case awaitingFailureHandling
        case awaitingApproval
        case complete
    }
    private var state: State = .awaitingOutcome
    private var stageCounter = 0

    init() {
        ask("What are you trying to achieve?", prompt: "Describe the outcome in plain words…")
    }

    // MARK: - Public API

    /// Submit a free-text answer. The engine advances based on its current state.
    func submit(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        appendUser(trimmed)

        switch state {
        case .awaitingOutcome:
            outcome = trimmed
            ask("What does success look like? How will you know when you're finished?",
                prompt: "Describe success in plain words…")
            state = .awaitingSuccessCriteria

        case .awaitingSuccessCriteria:
            successCriteria = trimmed
            ask("Who is involved in making this happen?",
                prompt: "Name people, teams, or roles…")
            state = .awaitingPeople

        case .awaitingPeople:
            let people = trimmed
            let stage = nextStage(title: "Get input from \(people)",
                                  text: "Collect what you need from \(people) before moving on.")
            propose(stage)

        case .awaitingStageName:
            pendingStage?.title = trimmed
            ask("What happens in this stage?",
                prompt: "Describe the work in plain words…")
            state = .awaitingStageDetail

        case .awaitingStageDetail:
            pendingStage?.text = trimmed
            ask("How will you know this stage is complete?",
                prompt: "e.g. “Everyone has replied”…")
            state = .awaitingDefinitionOfDone

        case .awaitingDefinitionOfDone:
            pendingStage?.definitionOfDone = trimmed
            if let stage = pendingStage { propose(stage) }

        case .awaitingFailureHandling:
            // The user's answer becomes a note on the most recent stage.
            if var last = stages.last {
                last.text += " If something goes wrong: \(trimmed)."
                stages[stages.count - 1] = last
            }
            ask("Is anyone required to approve this before it's finished?",
                prompt: "Yes or no, and who…")
            state = .awaitingApproval

        case .awaitingApproval:
            let lower = trimmed.lowercased()
            if lower.hasPrefix("y") || lower.contains("yes") {
                let stage = nextStage(title: "Approval",
                                      text: "Get sign-off from \(trimmed).")
                propose(stage)
            } else {
                finish()
            }

        case .proposingStage, .awaitingStageConfirmation, .complete:
            break
        }
    }

    /// Handle a tap on one of the current options (confirmation card or suggestion).
    func choose(_ option: String) {
        appendUser(option)
        switch state {
        case .awaitingStageConfirmation:
            switch option.lowercased() {
            case "yes":
                confirmPendingStage()
            case "change it":
                ask("What would you like to call this stage?",
                    prompt: "Stage name…")
                state = .awaitingStageName
            case "remove it":
                pendingStage = nil
                proposeNextStageOrFinish()
            default:
                break
            }
        default:
            break
        }
    }

    /// True while the engine is waiting for a confirmation choice.
    var awaitingConfirmation: Bool {
        if case .awaitingStageConfirmation = state { return true }
        return false
    }

    /// The current options to show (empty when free text is expected).
    var currentOptions: [String] {
        turns.last?.speaker == .ai ? turns.last?.options ?? [] : []
    }

    // MARK: - Internals

    private func nextStage(title: String, text: String) -> FlowStage {
        stageCounter += 1
        return FlowStage(id: "s\(stageCounter)", title: title, text: text)
    }

    private func propose(_ stage: FlowStage) {
        pendingStage = stage
        ask("I've drafted a stage called “\(stage.title)”. \(stage.text)\n\nDoes that sound right?",
            prompt: "",
            options: ["Yes", "Change it", "Remove it"],
            stage: stage)
        state = .awaitingStageConfirmation
    }

    private func confirmPendingStage() {
        guard let stage = pendingStage else { return }
        stages.append(stage)
        pendingStage = nil
        ask("What happens if something goes wrong at this stage?",
            prompt: "e.g. “Try again”, “Ask for help”…")
        state = .awaitingFailureHandling
    }

    private func proposeNextStageOrFinish() {
        if stages.count < 2 {
            let stage = nextStage(title: "Do the work",
                                  text: "Carry out the main task you described.")
            propose(stage)
        } else {
            finish()
        }
    }

    private func finish() {
        ask("That's a complete flow. You can run it, save it to the library, or keep refining it.",
            prompt: "")
        state = .complete
    }

    private func ask(_ text: String, prompt: String, options: [String] = [], stage: FlowStage? = nil) {
        turns.append(InterviewTurn(speaker: .ai, text: text, options: options, stage: stage))
        currentPrompt = prompt
    }

    private func appendUser(_ text: String) {
        turns.append(InterviewTurn(speaker: .user, text: text))
        currentPrompt = ""
    }

    // MARK: - Flow synthesis

    /// Build a runnable `Flow` from the interview so far. The stage tree is kept
    /// alongside the block graph so the Flows UI can render the conversation view
    /// while `/flow-run` executes the block graph.
    var flow: Flow {
        let title = outcome.isEmpty ? "Untitled flow" : outcome
        let (blocks, connections) = Flow.Graph.blocksFromStages(stages, title: title)
        var graph = Flow.Graph(blocks: blocks, connections: connections)
        graph.stages = stages
        return Flow(title: title, flow: graph, review: nil, run: nil, metadata: FlowMetadata(description: successCriteria))
    }
}
