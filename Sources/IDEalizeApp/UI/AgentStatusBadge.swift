import SwiftUI

/// A small status tag shown on session tabs and rail cards: Working, Waiting,
/// or Complete. "Waiting" (the agent asked you something and is blocked on your
/// answer) is the one that needs attention, so it gently pulses. When there's
/// no agent activity it falls back to a plain running/activity dot.
struct AgentStatusBadge: View {
    @ObservedObject var session: TerminalSession
    /// Tighter padding/type for the horizontal tab strip.
    var compact = false

    var body: some View {
        switch session.agentStatus {
        case .idle:     SessionStatusDot(session: session)
        case .working:  WorkingSpinner(compact: compact, agentName: session.agentDisplayName)
        case .waiting:  StatusPill(kind: .waiting, compact: compact, agentName: session.agentDisplayName)
        case .complete: StatusPill(kind: .complete, compact: compact, agentName: session.agentDisplayName)
        }
    }
}

/// Working = a bare spinner, no label. Tinted a calm blue (never the red/pink
/// action colour) so it reads as "in progress".
private struct WorkingSpinner: View {
    let compact: Bool
    let agentName: String
    var body: some View {
        ProgressView()
            .controlSize(.small)
            .tint(Color(red: 0.23, green: 0.51, blue: 0.96))
            .scaleEffect(compact ? 0.72 : 0.9)
            .frame(width: compact ? 16 : 20, height: compact ? 16 : 20)
            .help("\(agentName) is working")
    }
}

/// Waiting (bell) and Complete (checkmark) — a glyph-only round badge in the
/// interface highlight colour. Waiting pulses for attention; Complete is static.
private struct StatusPill: View {
    let kind: AgentStatus        // .waiting or .complete
    let compact: Bool
    let agentName: String
    @ObservedObject private var settings = AppSettings.shared
    @State private var pulse = false

    private var isWaiting: Bool { kind == .waiting }
    private var icon: String { isWaiting ? "bell.fill" : "checkmark" }
    private var tint: Color { settings.actionStyle.color }

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: compact ? 9 : 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(compact ? 4 : 6)
            .background(Circle().fill(tint))
            .scaleEffect(isWaiting && pulse ? 1.08 : 1.0)
            .shadow(color: isWaiting ? tint.opacity(pulse ? 0.8 : 0.0) : .clear,
                    radius: isWaiting ? (pulse ? 5 : 1) : 0)
            .onAppear {
                guard isWaiting else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
            .help(isWaiting ? "\(agentName) asked a question — waiting on you"
                            : "\(agentName) finished — nothing outstanding")
    }
}

/// Plain running/activity dot used when no agent status applies.
struct SessionStatusDot: View {
    @ObservedObject var session: TerminalSession
    private var color: Color {
        if !session.isRunning { return .red }
        if session.hasActivity || session.unreadCount > 0 { return .orange }
        return session.isShellForeground ? .gray : .green
    }
    var body: some View { Circle().fill(color).frame(width: 8, height: 8) }
}
