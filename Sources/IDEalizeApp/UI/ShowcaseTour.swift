import SwiftUI

// MARK: - Anchoring
//
// The first anchor-measurement system in the app. Panels mark themselves with
// `.tourTarget(_:)`; the tour resolves those anchors against the window to cut a
// spotlight and park a callout beside the real control. Anchors are collected as
// `Anchor<CGRect>` rather than raw frames so SwiftUI resolves them in whatever
// space the reader asks for — no manual coordinate maths, and nothing to go stale
// when a panel is dragged wider.

/// A control or region the tour can point at. Only cases that actually resolve to
/// an on-screen anchor are toured, so hidden panels simply drop out of the run.
enum TourTarget: Hashable {
    case sessions
    case files
    case modeToggle
    case chatInput
    case skills
    case toolbar
}

struct TourAnchorKey: PreferenceKey {
    static var defaultValue: [TourTarget: Anchor<CGRect>] { [:] }

    static func reduce(value: inout [TourTarget: Anchor<CGRect>],
                       nextValue: () -> [TourTarget: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// Marks this view as a tour target. Cheap: one anchor per marked view, only
    /// read when the tour is on screen.
    func tourTarget(_ target: TourTarget) -> some View {
        anchorPreference(key: TourAnchorKey.self, value: .bounds) { [target: $0] }
    }
}

// MARK: - Content

struct TourStep: Identifiable {
    let id = UUID()
    /// `nil` for the opening card, which floats centred rather than pointing at
    /// anything.
    let target: TourTarget?
    let icon: String
    let title: String
    let body: String
}

enum TourScript {
    /// Written for someone who has never used a terminal. Each step names the
    /// thing, says what it is for, and points at where it lives — no jargon left
    /// unexplained.
    static let steps: [TourStep] = [
        TourStep(
            target: nil,
            icon: "sparkles",
            title: "Welcome to IDEalize",
            body: "This is a workspace for building things with Claude — your files on one side, a conversation on the other, and Claude able to see and change both.\n\nHere's a quick look at where everything lives."
        ),
        TourStep(
            target: .sessions,
            icon: "sidebar.left",
            title: "Your sessions",
            body: "Each folder you work in gets its own session, listed here. They keep running side by side, so you can leave Claude working on one and switch to another.\n\nUse + to start a new one."
        ),
        TourStep(
            target: .files,
            icon: "folder",
            title: "The project's files",
            body: "Everything in the folder you're working in. Click a file to open it, and Claude can read and edit anything you see here.\n\nThe tray icon at the top lets you browse the rest of your Mac and drag other files in."
        ),
        TourStep(
            target: .modeToggle,
            icon: "arrow.left.arrow.right",
            title: "Chat or Terminal",
            body: "Two views of the same session. Chat is where you talk to Claude in plain English. Terminal is the raw text interface underneath — the thing Claude is actually driving.\n\nNothing is hidden from you; flip between them whenever you're curious."
        ),
        TourStep(
            target: .chatInput,
            icon: "text.cursor",
            title: "Ask for anything",
            body: "Describe what you want in your own words — \"make the header sticky\", \"why is this crashing?\" — and Claude works in the project directly.\n\nDrag a file onto the pane to attach it to the conversation."
        ),
        TourStep(
            target: .skills,
            icon: "slider.horizontal.3",
            title: "How Claude works",
            body: "Choose which Claude model to use and how long it should think before answering. Skills and commands are reusable instructions you've saved.\n\nFlow (on the left) is for longer jobs: sketch the steps first, then hand the whole plan over at once."
        ),
        TourStep(
            target: .toolbar,
            icon: "square.bottomhalf.filled",
            title: "Panels and tools",
            body: "Show or hide any panel, open the command palette (⌘P), or split the view to see two terminals at once.\n\nThe spanner opens the service hatch — a Claude session on IDEalize's own code, so you can change the app you're using."
        )
    ]
}

// MARK: - Overlay

/// The first-run showcase: dims the app, cuts a hole around one control at a
/// time, and explains it. Mirrors the CommandPalette idiom (scrim + floating
/// card gated on a `@Published` flag) rather than inventing new chrome.
struct ShowcaseTour: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    /// Anchors resolved by the caller against the window.
    let rects: [TourTarget: CGRect]
    let container: CGSize

    /// Snapshotted on appear. If we filtered live, a step's index would shift
    /// under the user the moment Claude finishes booting and the chat anchors
    /// appear mid-tour.
    @State private var steps: [TourStep] = []
    @State private var index = 0
    @State private var cardSize = CGSize(width: TourLayout.cardWidth, height: 200)

    private var theme: Theme { settings.theme }
    private var step: TourStep? { steps.indices.contains(index) ? steps[index] : nil }
    /// The hole to cut. `nil` on the opening card, or if a target vanished
    /// mid-tour — either way the card just floats centred.
    private var spotlight: CGRect? { step?.target.flatMap { rects[$0] } }

    var body: some View {
        ZStack(alignment: .topLeading) {
            scrim
            if let rect = spotlight { ring(rect) }
            if let step { card(step) }
        }
        .ignoresSafeArea()
        .onAppear(perform: begin)
        .animation(.spring(response: 0.34, dampingFraction: 0.82), value: index)
    }

    // MARK: Pieces

    /// A dim over the whole window with the spotlight punched out of it.
    private var scrim: some View {
        Rectangle()
            .fill(Color.black.opacity(0.58))
            .mask {
                Rectangle()
                    .overlay(alignment: .topLeading) {
                        if let rect = spotlight {
                            RoundedRectangle(cornerRadius: TourLayout.holeRadius, style: .continuous)
                                .frame(width: rect.width + TourLayout.holePad * 2,
                                       height: rect.height + TourLayout.holePad * 2)
                                .offset(x: rect.minX - TourLayout.holePad,
                                        y: rect.minY - TourLayout.holePad)
                                .blendMode(.destinationOut)
                        }
                    }
                    .compositingGroup()
            }
            // The scrim is the dismiss surface, matching CommandPalette. The hole
            // is masked out visually but still part of this shape, so a tap in the
            // spotlight would also land here — acceptable: it ends the tour and
            // hands the control straight back.
            .contentShape(Rectangle())
            .onTapGesture(perform: finish)
    }

    /// The highlight ring. Interactive target, so it takes the action highlight —
    /// `.fill`, not `.color`, which washes out to the terminal accent when the
    /// user's highlight is a gradient.
    private func ring(_ rect: CGRect) -> some View {
        RoundedRectangle(cornerRadius: TourLayout.holeRadius, style: .continuous)
            .strokeBorder(settings.actionStyle.fill, lineWidth: 2)
            .frame(width: rect.width + TourLayout.holePad * 2,
                   height: rect.height + TourLayout.holePad * 2)
            .offset(x: rect.minX - TourLayout.holePad, y: rect.minY - TourLayout.holePad)
            .allowsHitTesting(false)
    }

    private func card(_ step: TourStep) -> some View {
        let origin = TourLayout.place(card: cardSize, beside: spotlight, in: container)

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                // Decorative, not interactive — so it takes the text colour and
                // stays as legible as the title beside it.
                Image(systemName: step.icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(theme.foreground))
                Text(step.title)
                    .font(settings.ui(15, .semibold))
                    .foregroundStyle(Color(theme.foreground))
            }

            Text(step.body)
                .font(settings.ui(12))
                .foregroundStyle(Color(theme.secondaryForeground))
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)

            HStack(spacing: 8) {
                dots
                Spacer()
                if index > 0 {
                    Button("Back") { index -= 1 }
                        .buttonStyle(.plain)
                        .font(settings.ui(12, .medium))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                Button(action: advance) {
                    Text(isLast ? "Get started" : "Next")
                        .font(settings.ui(12, .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Capsule().fill(settings.actionStyle.fill))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 2)
        }
        .padding(14)
        .frame(width: TourLayout.cardWidth, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(theme.surface))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color(theme.border), lineWidth: 1))
                .shadow(color: .black.opacity(0.34), radius: 18, y: 6)
        )
        .background(GeometryReader { g in
            Color.clear.preference(key: TourCardSizeKey.self, value: g.size)
        })
        .onPreferenceChange(TourCardSizeKey.self) { size in
            if size.height > 0 { cardSize = size }
        }
        .offset(x: origin.x, y: origin.y)
        // Skip is the escape hatch and must not steal Return from Next.
        .overlay {
            Button("", action: finish)
                .keyboardShortcut(.cancelAction)
                .opacity(0)
        }
    }

    private var dots: some View {
        HStack(spacing: 4) {
            ForEach(steps.indices, id: \.self) { i in
                Circle()
                    .fill(i == index ? settings.actionStyle.fill
                                     : AnyShapeStyle(Color(theme.border)))
                    .frame(width: 5, height: 5)
            }
        }
    }

    // MARK: Behaviour

    private var isLast: Bool { index >= steps.count - 1 }

    private func begin() {
        guard steps.isEmpty else { return }
        // Drop any step whose control isn't on screen — a hidden file explorer
        // shouldn't leave a callout pointing at nothing.
        steps = TourScript.steps.filter { $0.target == nil || rects[$0.target!] != nil }
        if steps.isEmpty { finish() }
    }

    private func advance() {
        if isLast { finish() } else { index += 1 }
    }

    private func finish() {
        settings.hasSeenTour = true
        workspace.showTour = false
    }
}

private struct TourCardSizeKey: PreferenceKey {
    static var defaultValue: CGSize { .zero }
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

// MARK: - Placement

enum TourLayout {
    static let cardWidth: CGFloat = 330
    static let holePad: CGFloat = 6
    static let holeRadius: CGFloat = 10
    private static let gap: CGFloat = 16
    private static let margin: CGFloat = 20

    /// Parks the card beside the spotlight: right of it if it fits, else left,
    /// else above, else below — then clamps to the window so it can never hang off
    /// an edge. With no spotlight (the opening card) it sits dead centre.
    static func place(card: CGSize, beside rect: CGRect?, in container: CGSize) -> CGPoint {
        guard let rect else {
            return CGPoint(x: (container.width - card.width) / 2,
                           y: (container.height - card.height) / 2)
        }

        let fitsRight = rect.maxX + gap + card.width <= container.width - margin
        let fitsLeft = rect.minX - gap - card.width >= margin
        let fitsAbove = rect.minY - gap - card.height >= margin

        let x: CGFloat
        let y: CGFloat
        if fitsRight {
            x = rect.maxX + gap
            y = rect.minY
        } else if fitsLeft {
            x = rect.minX - gap - card.width
            y = rect.minY
        } else if fitsAbove {
            // A full-width target (the bottom toolbar) fits on neither side, so the
            // card centres over it instead.
            x = rect.midX - card.width / 2
            y = rect.minY - gap - card.height
        } else {
            x = rect.midX - card.width / 2
            y = rect.maxY + gap
        }

        return CGPoint(x: clamp(x, card.width, container.width),
                       y: clamp(y, card.height, container.height))
    }

    private static func clamp(_ v: CGFloat, _ size: CGFloat, _ bound: CGFloat) -> CGFloat {
        // A window narrower/shorter than the card + margins would invert the range;
        // pin to the near margin rather than trap `max` above `min`.
        let limit = bound - size - margin
        guard limit > margin else { return margin }
        return min(max(v, margin), limit)
    }
}
