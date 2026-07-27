import Foundation

/// How much autonomy the agent runs with — chosen in the chat toolbar and applied
/// as a launch flag on the Claude Code CLI. IDEalize has always launched with
/// permissions skipped ("Yolo"); this lets a chat opt into a safer posture instead.
enum PermissionMode: String, CaseIterable, Identifiable {
    /// Read-only: the agent proposes a plan and changes nothing until you approve.
    case plan
    /// The agent asks before each action (Claude Code's own default).
    case ask
    /// The agent applies file edits itself but still asks for other actions.
    case acceptEdits
    /// No prompts at all — full autonomy (`--dangerously-skip-permissions`).
    case yolo

    var id: String { rawValue }

    /// Short, plain-language name shown on the pill and in the picker.
    var label: String {
        switch self {
        case .plan: return "Plan"
        case .ask: return "Ask"
        case .acceptEdits: return "Auto-edit"
        case .yolo: return "Yolo"
        }
    }

    /// One-line description shown under the label in the picker.
    var blurb: String {
        switch self {
        case .plan: return "Proposes a plan first — changes nothing"
        case .ask: return "Asks before each change"
        case .acceptEdits: return "Makes edits, asks for the rest"
        case .yolo: return "No prompts — full autonomy"
        }
    }

    var icon: String {
        switch self {
        case .plan: return "list.clipboard"
        case .ask: return "hand.raised"
        case .acceptEdits: return "pencil"
        case .yolo: return "hare.fill"
        }
    }

    /// True for modes worth flagging visually — Yolo skips every safety prompt.
    var isDangerous: Bool { self == .yolo }

    /// The Claude Code CLI flag that selects this mode at launch.
    var launchFlag: String {
        switch self {
        case .plan: return "--permission-mode plan"
        case .ask: return "--permission-mode default"
        case .acceptEdits: return "--permission-mode acceptEdits"
        case .yolo: return "--dangerously-skip-permissions"
        }
    }
}
