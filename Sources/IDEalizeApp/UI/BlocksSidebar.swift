import SwiftUI
import AppKit

/// Right-hand sidebar listing the focused terminal's command blocks (Warp-style):
/// each past command with its exit status, duration, copy and re-run actions.
struct BlocksSidebar: View {
    @ObservedObject var workspace: Workspace

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Blocks").font(.system(size: 12, weight: .semibold))
                Spacer()
                Button { workspace.showSidebar = false } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, 12).frame(height: 34)
            Divider()
            if let session = workspace.focusedSession {
                SessionBlocks(session: session)
            } else {
                Spacer()
                Text("No terminal focused").font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
        }
        .frame(width: 290)
        .background(.bar)
    }
}

private struct SessionBlocks: View {
    @ObservedObject var session: TerminalSession

    var body: some View {
        if session.blocks.isEmpty {
            VStack(spacing: 6) {
                Spacer()
                Image(systemName: "square.stack.3d.up").font(.title2).foregroundStyle(.secondary)
                Text("Commands you run appear here").font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Spacer()
            }.padding()
        } else {
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(session.blocks.reversed()) { block in
                        BlockRow(block: block, session: session)
                    }
                }
                .padding(8)
            }
        }
    }
}

private struct BlockRow: View {
    let block: CommandBlock
    let session: TerminalSession
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                statusIcon
                Text(block.command)
                    .font(.system(size: 12, design: .monospaced))
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                if let cwd = block.cwd {
                    Text((cwd as NSString).lastPathComponent)
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                if let d = block.duration {
                    Text(format(d)).font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer()
                if hovering {
                    Button { copy(block.command) } label: {
                        Image(systemName: "doc.on.doc").font(.system(size: 10))
                    }.buttonStyle(.plain).help("Copy command")
                    Button { session.rerun(block.command) } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 10))
                    }.buttonStyle(.plain).help("Re-run")
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(hovering ? 0.16 : 0.08)))
        .overlay(alignment: .leading) {
            Rectangle().fill(statusColor).frame(width: 3)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Copy Command") { copy(block.command) }
            Button("Re-run") { session.rerun(block.command) }
        }
    }

    private var statusColor: Color {
        if block.isRunning { return .orange }
        switch block.succeeded {
        case .some(true): return .green
        case .some(false): return .red
        default: return .gray
        }
    }

    @ViewBuilder private var statusIcon: some View {
        if block.isRunning {
            Image(systemName: "circle.dotted").foregroundStyle(.orange).font(.system(size: 11))
        } else if block.succeeded == true {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.system(size: 11))
        } else {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.system(size: 11))
        }
    }

    private func format(_ d: TimeInterval) -> String {
        d < 1 ? String(format: "%.0fms", d * 1000) : String(format: "%.1fs", d)
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }
}
