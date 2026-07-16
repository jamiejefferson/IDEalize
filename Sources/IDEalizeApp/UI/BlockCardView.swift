import SwiftUI
import AppKit

/// Scrollable column of command blocks (history) for one session — the Warp
/// "blocks" view. Newest at the bottom; auto-scrolls as commands complete.
struct BlocksScrollView: View {
    @ObservedObject var session: TerminalSession

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(session.blocks) { block in
                        BlockCard(block: block, session: session).id(block.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .onChange(of: session.blocks.count) {
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: session.blocks.last?.outputLineCount ?? 0) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }
}

/// A single Warp-style command block: a rounded card with a status accent rail,
/// a header (prompt glyph · command · cwd · duration · hover actions) over the
/// rendered, colored output.
struct BlockCard: View {
    let block: CommandBlock
    let session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false

    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 0) {
            // Status accent rail down the left edge.
            Rectangle().fill(statusColor).frame(width: 3)
            VStack(alignment: .leading, spacing: 0) {
                header
                if block.interactive {
                    bodyLabel("Interactive session", icon: "macwindow")
                } else if let output = block.output, output.length > 0 {
                    Divider().overlay(Color(theme.border))
                    outputView(output)
                } else if block.isRunning {
                    bodyLabel("Running…", icon: "circle.dotted")
                }
            }
        }
        .background(Color(hovering ? theme.surfaceHover : theme.surface))
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Color(theme.border), lineWidth: 1))
        .onHover { hovering = $0 }
    }

    private var header: some View {
        HStack(spacing: 8) {
            statusIcon
            Text("›")
                .font(settings.mono(13, .bold))
                .foregroundStyle(Color(theme.accent))
            Text(block.command)
                .font(settings.mono(13, .medium))
                .foregroundStyle(Color(theme.foreground))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            if hovering {
                actionButton("doc.on.doc", help: "Copy command") { copy(block.command) }
                if !block.plainOutput.isEmpty {
                    actionButton("doc.plaintext", help: "Copy output") { copy(block.plainOutput) }
                }
                actionButton("arrow.clockwise", help: "Re-run") { session.rerun(block.command) }
            } else {
                if let cwd = block.cwd, !cwd.isEmpty {
                    Text((cwd as NSString).lastPathComponent)
                        .font(settings.ui(11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                if let d = block.duration {
                    Text(format(d))
                        .font(settings.ui(11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .monospacedDigit()
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
    }

    @ViewBuilder
    private func outputView(_ output: NSAttributedString) -> some View {
        let text = Text(AttributedString(output))
            .font(.custom(settings.fontName, size: settings.fontSize))
            .textSelection(.enabled)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 9)

        if block.outputLineCount > 26 {
            ScrollView { text }.frame(maxHeight: 420)
        } else {
            text
        }
    }

    private func bodyLabel(_ s: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11))
            Text(s).font(settings.ui(12))
        }
        .foregroundStyle(Color(theme.secondaryForeground))
        .padding(.horizontal, 12).padding(.bottom, 10).padding(.top, 4)
    }

    private func actionButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 11))
        }
        .buttonStyle(.iconHover(padding: 3))
        .foregroundStyle(Color(theme.secondaryForeground))
        .help(help)
    }

    private var statusColor: Color {
        if block.isRunning { return .orange }
        switch block.succeeded {
        case .some(true): return Color(theme.accent)
        case .some(false): return .red
        default: return Color(theme.border)
        }
    }

    @ViewBuilder private var statusIcon: some View {
        if block.isRunning {
            ProgressView().controlSize(.small).scaleEffect(0.7).frame(width: 14, height: 14)
        } else if block.succeeded == true {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.system(size: 12))
        } else {
            HStack(spacing: 3) {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.system(size: 12))
                if let c = block.exitCode, c != 0 {
                    Text("\(c)").font(.system(size: 10, weight: .bold)).foregroundStyle(.red)
                }
            }
        }
    }

    private func format(_ d: TimeInterval) -> String {
        d < 1 ? String(format: "%.0fms", d * 1000) : String(format: "%.2fs", d)
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }
}
