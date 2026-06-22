import SwiftUI
import AppKit

/// A lazily-populated node in the file tree. Directory children are only read
/// from disk the first time the folder is expanded.
final class FileNode: ObservableObject, Identifiable {
    let id = UUID()
    let url: URL
    let isDirectory: Bool
    let name: String
    @Published var expanded = false
    @Published var children: [FileNode]?

    init(url: URL, isDirectory: Bool) {
        self.url = url
        self.isDirectory = isDirectory
        self.name = url.lastPathComponent
    }

    func toggle() {
        guard isDirectory else { return }
        expanded.toggle()
        if expanded && children == nil { load() }
    }

    func load() {
        let keys: [URLResourceKey] = [.isDirectoryKey]
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: url, includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles])) ?? []
        children = contents
            .map { u -> FileNode in
                let isDir = (try? u.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                return FileNode(url: u, isDirectory: isDir)
            }
            .sorted { a, b in
                if a.isDirectory != b.isDirectory { return a.isDirectory }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
    }
}

/// The middle file-explorer panel: shows the focused terminal's working
/// directory as a navigable tree. Clicking a file types its path into the
/// terminal; clicking a folder expands it.
struct FileExplorerPanel: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    var body: some View {
        if let session = workspace.focusedSession {
            FileExplorerInner(session: session, workspace: workspace)
                .id(workspace.focusedSessionID)
        } else {
            VStack(spacing: 0) {
                HStack {
                    Text("Files").font(settings.ui(12, .semibold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                    Spacer()
                }.padding(.horizontal, 12).frame(height: 34)
                Rectangle().fill(Color(theme.border)).frame(height: 1)
                VStack(spacing: 14) {
                    Spacer()
                    Image(systemName: "folder.badge.plus").font(.system(size: 32))
                        .foregroundStyle(Color(theme.secondaryForeground))
                    Text("No folder open").font(style.font(13))
                        .foregroundStyle(style.secondaryTextColor)
                    Button(action: { workspace.newTabPickingFolder() }) {
                        Label("Open a folder…", systemImage: "plus")
                            .font(settings.ui(12, .medium))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(RoundedRectangle(cornerRadius: 8).fill(settings.actionStyle.fill))
                            .foregroundStyle(.white)
                    }.buttonStyle(.plain)
                    Spacer()
                }.frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(style.background)
        }
    }
}

private struct FileExplorerInner: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @State private var root: FileNode?
    @State private var rootPath = ""
    @State private var creatingFolder = false
    @State private var newFolderName = ""

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let root, let kids = root.children {
                        ForEach(kids) { node in
                            FileRow(node: node, depth: 0, onOpenFile: openFile)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(style.background)
        .onAppear { rebuild() }
        .onChange(of: session.projectPath ?? "") { rebuild() }
        .onChange(of: workspace.fileTreeVersion) { rebuild(force: true) }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "folder.fill")
                .font(.system(size: 11))
                .foregroundStyle(Color(theme.accent))
            Text(rootName)
                .font(settings.ui(12, .semibold))
                .foregroundStyle(Color(theme.foreground))
                .lineLimit(1)
            Spacer()
            Button(action: { newFolderName = ""; creatingFolder = true }) {
                Image(systemName: "folder.badge.plus")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain)
            .help("New folder")
            Button(action: { rebuild(force: true) }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain)
            .help("Refresh")
        }
        .padding(.horizontal, 12).frame(height: 34)
        .sheet(isPresented: $creatingFolder) {
            VStack(alignment: .leading, spacing: 14) {
                Text("New Folder").font(settings.ui(15, .semibold))
                TextField("Folder name", text: $newFolderName)
                    .textFieldStyle(.roundedBorder).frame(width: 280)
                    .onSubmit(createFolder)
                HStack {
                    Spacer()
                    Button("Cancel") { creatingFolder = false }
                    Button("Create") { createFolder() }.keyboardShortcut(.defaultAction)
                }
            }.padding(20)
        }
    }

    private func createFolder() {
        creatingFolder = false
        let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !rootPath.isEmpty else { return }
        let url = URL(fileURLWithPath: rootPath).appendingPathComponent(name)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        rebuild(force: true)
    }

    private var rootName: String {
        let p = rootPath.isEmpty ? (session.projectPath ?? "") : rootPath
        let last = (p as NSString).lastPathComponent
        return last.isEmpty ? "/" : last
    }

    private func rebuild(force: Bool = false) {
        let path = (session.projectPath?.isEmpty == false ? session.projectPath! :
                        FileManager.default.homeDirectoryForCurrentUser.path)
        guard force || path != rootPath || root == nil else { return }
        rootPath = path
        let node = FileNode(url: URL(fileURLWithPath: path), isDirectory: true)
        node.expanded = true
        node.load()
        root = node
    }

    /// Open a clicked file in the document panel.
    private func openFile(_ url: URL) {
        workspace.viewedFile = url
        workspace.showViewer = true
    }
}

/// A single row in the file tree; recurses to render expanded folders.
private struct FileRow: View {
    @ObservedObject var node: FileNode
    let depth: Int
    let onOpenFile: (URL) -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Color.clear.frame(width: CGFloat(depth) * 12)
                if node.isDirectory {
                    Image(systemName: node.expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .frame(width: 10)
                } else {
                    Color.clear.frame(width: 10)
                }
                Image(systemName: node.isDirectory ? "folder.fill" : icon(for: node.name))
                    .font(.system(size: 11))
                    .foregroundStyle(Color(node.isDirectory ? theme.accent : theme.secondaryForeground))
                    .frame(width: 15)
                Text(node.name)
                    .font(style.font(12))
                    .foregroundStyle(style.textColor)
                    .panelText(style)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).padding(.vertical, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hovering ? theme.surface : .clear))
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .onTapGesture {
                if node.isDirectory { withAnimation(.easeOut(duration: 0.1)) { node.toggle() } }
                else { onOpenFile(node.url) }
            }
            .onDrag { NSItemProvider(object: node.url as NSURL) }

            if node.isDirectory, node.expanded, let kids = node.children {
                ForEach(kids) { child in
                    FileRow(node: child, depth: depth + 1, onOpenFile: onOpenFile)
                }
            }
        }
    }

    private func icon(for name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "md", "txt", "rtf": return "doc.text"
        case "json", "yml", "yaml", "toml", "plist": return "curlybraces"
        case "png", "jpg", "jpeg", "gif", "icns", "svg": return "photo"
        case "sh", "zsh", "bash": return "terminal"
        default: return "doc"
        }
    }
}
