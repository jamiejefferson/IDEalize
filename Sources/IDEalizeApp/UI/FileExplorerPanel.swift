import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// A lazily-populated node in the file tree. Directory children are only read
/// from disk the first time the folder is expanded.
final class FileNode: ObservableObject, Identifiable {
    let id = UUID()
    let url: URL
    /// `url.standardizedFileURL`, computed once — a FileRow's body runs per
    /// render, and path normalization has no place in it.
    let standardizedURL: URL
    let isDirectory: Bool
    let name: String
    @Published var expanded = false
    @Published var children: [FileNode]?
    /// Monotonic token so a stale background enumeration (an older load or
    /// refresh that finishes late) never overwrites newer state.
    private var loadGeneration = 0

    init(url: URL, isDirectory: Bool) {
        self.url = url
        self.standardizedURL = url.standardizedFileURL
        self.isDirectory = isDirectory
        self.name = url.lastPathComponent
    }

    func toggle() {
        guard isDirectory else { return }
        expanded.toggle()
        if expanded && children == nil { load() }
    }

    /// Expand without collapsing an already-open folder (used to reveal a drop).
    /// `completion` fires on main once this node's children are in memory —
    /// immediately if already loaded, otherwise when the enumeration lands.
    func expand(completion: (() -> Void)? = nil) {
        guard isDirectory else { completion?(); return }
        if !expanded { expanded = true }
        if children == nil { load(completion: completion) } else { completion?() }
    }

    /// Open every folder between this node and `target`, then yield the node that
    /// stands for `target` (on main). Yields nil if `target` isn't under this
    /// node, or isn't listed in the tree at all (a hidden file, or one deleted
    /// since it was asked for).
    ///
    /// Directories along the way are loaded on demand, so this reaches a file the
    /// user has never expanded down to. Enumeration happens off the main thread,
    /// so the walk continues asynchronously as each listing lands.
    func revealDescendant(_ target: URL, completion: @escaping (FileNode?) -> Void) {
        let rootPath = standardizedURL.path
        let targetPath = target.standardizedFileURL.path
        if targetPath == rootPath { completion(self); return }
        guard targetPath.hasPrefix(rootPath + "/") else { completion(nil); return }
        reveal(targetPath.dropFirst(rootPath.count + 1).split(separator: "/").map(String.init),
               completion: completion)
    }

    private func reveal(_ components: [String], completion: @escaping (FileNode?) -> Void) {
        guard let first = components.first else {
            // Revealing a folder means "show me what's in it".
            if isDirectory { expand() }
            completion(self)
            return
        }
        guard isDirectory else { completion(nil); return }
        expand { [weak self] in
            guard let self, let next = self.children?.first(where: { $0.name == first }) else {
                completion(nil); return
            }
            next.reveal(Array(components.dropFirst()), completion: completion)
        }
    }

    func load(completion: (() -> Void)? = nil) {
        loadGeneration += 1
        let generation = loadGeneration
        let url = self.url
        Self.enumerate(url) { [weak self] entries in
            guard let self, generation == self.loadGeneration else { return }
            self.children = entries.map { FileNode(url: $0.url, isDirectory: $0.isDirectory) }
            completion?()
        }
    }

    /// Re-read this directory in place, reusing existing child nodes (matched by
    /// URL) so a folder's expanded state — and any children already loaded under
    /// it — survive the refresh. Recurses into open subfolders. This is what lets
    /// the tree pick up files written on disk (e.g. by Claude) without collapsing.
    func refresh() {
        guard isDirectory, children != nil else { return }
        loadGeneration += 1
        let generation = loadGeneration
        let url = self.url
        Self.enumerate(url) { [weak self] entries in
            guard let self, generation == self.loadGeneration else { return }
            let existing = Dictionary((self.children ?? []).map { ($0.url, $0) }) { a, _ in a }
            self.children = entries.map { e in
                if let node = existing[e.url] {
                    if node.isDirectory && node.expanded { node.refresh() }
                    return node
                }
                return FileNode(url: e.url, isDirectory: e.isDirectory)
            }
        }
    }

    /// One directory's visible children, enumerated off the main thread — a big
    /// tree stalls the UI if read synchronously (expanding a folder, or the
    /// FSEvents watcher refreshing after a burst of writes). Sorted the way the
    /// tree shows them; the completion lands on the main queue.
    private static func enumerate(_ url: URL,
                                  completion: @escaping ([(url: URL, isDirectory: Bool)]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let keys: [URLResourceKey] = [.isDirectoryKey]
            let contents = (try? FileManager.default.contentsOfDirectory(
                at: url, includingPropertiesForKeys: keys,
                options: [.skipsHiddenFiles])) ?? []
            let entries = contents.map { u -> (url: URL, isDirectory: Bool) in
                (u, (try? u.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false)
            }.sorted { a, b in
                if a.isDirectory != b.isDirectory { return a.isDirectory }
                return a.url.lastPathComponent.localizedCaseInsensitiveCompare(b.url.lastPathComponent) == .orderedAscending
            }
            DispatchQueue.main.async { completion(entries) }
        }
    }
}

/// Watches a directory tree (recursively) for filesystem changes via FSEvents,
/// firing `onChange` on the main queue with the changed file paths — coalesced,
/// so a burst of writes (a Claude turn dropping several files) lands as one
/// refresh. Held by the explorer for as long as it shows a given folder, and by
/// `ProjectMonitor` to notice when two chats touch the same file.
final class DirectoryWatcher {
    private var stream: FSEventStreamRef?
    private var onChange: (([String]) -> Void)?

    func start(path: String, onChange: @escaping ([String]) -> Void) {
        stop()
        self.onChange = onChange
        var ctx = FSEventStreamContext(version: 0,
                                       info: Unmanaged.passUnretained(self).toOpaque(),
                                       retain: nil, release: nil, copyDescription: nil)
        let cb: FSEventStreamCallback = { _, info, _, paths, _, _ in
            guard let info else { return }
            // `paths` is a CFArray of per-file path strings only because the
            // stream is created with kFSEventStreamCreateFlagUseCFTypes;
            // without that flag it is a raw char** and this cast crashes.
            let changed = (unsafeBitCast(paths, to: CFArray.self) as? [String]) ?? []
            Unmanaged<DirectoryWatcher>.fromOpaque(info).takeUnretainedValue().onChange?(changed)
        }
        guard let s = FSEventStreamCreate(
            kCFAllocatorDefault, cb, &ctx, [path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.4,   // latency: coalesce bursts of writes into one fire
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes
                                     | kFSEventStreamCreateFlagFileEvents
                                     | kFSEventStreamCreateFlagNoDefer)
        ) else { return }
        stream = s
        FSEventStreamSetDispatchQueue(s, .main)
        FSEventStreamStart(s)
    }

    func stop() {
        // FSEvents delivers callbacks on `.main` (see `start`). This object is held
        // by SwiftUI `@State` and `ProjectMonitor`, so ARC can call `deinit` — and
        // thus `stop()` — on any thread. Tearing the stream down off-main races a
        // callback that may be mid-flight on main: `FSEventStreamInvalidate` frees
        // the event's `paths` array underneath the running `as? [String]` bridge,
        // which then messages a dangling element and crashes (SIGSEGV in
        // objc_msgSend). Serialise all teardown on main so it can never overlap a
        // callback, and clear `onChange` there too so any already-queued callback
        // is a no-op. Synchronous, so a live stream never outlives this object.
        let teardown = { [self] in
            guard let s = stream else { return }
            FSEventStreamStop(s); FSEventStreamInvalidate(s); FSEventStreamRelease(s)
            stream = nil
            onChange = nil
        }
        if Thread.isMainThread { teardown() }
        else { DispatchQueue.main.sync(execute: teardown) }
    }

    deinit { stop() }
}

/// What a tree's rows can do. The project tree accepts drops (copying files in)
/// and opens files; the browse tree is a *source* of drags, and offers "Copy to
/// Project" and "Browse Here" instead. A nil closure means the row omits that
/// affordance entirely.
struct FileTreeActions {
    var onOpenFile: (URL) -> Void
    /// Copy `sources` into the folder `destination`. nil ⇒ tree rejects drops.
    var onDropInto: ((_ destination: URL, _ sources: [URL]) -> Void)?
    /// nil ⇒ no "Copy to Project" menu item.
    var onCopyToProject: ((URL) -> Void)?
    /// nil ⇒ no "Browse Here" menu item.
    var onBrowseHere: ((URL) -> Void)?
}

/// Resolve a drop's item providers to file URLs, calling back on the main queue.
private func loadDroppedURLs(_ providers: [NSItemProvider], completion: @escaping ([URL]) -> Void) {
    let lock = NSLock()
    var urls: [URL] = []
    let group = DispatchGroup()
    for provider in providers where provider.canLoadObject(ofClass: URL.self) {
        group.enter()
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
            if let url, url.isFileURL {
                lock.lock(); urls.append(url); lock.unlock()
            }
            group.leave()
        }
    }
    group.notify(queue: .main) { completion(urls) }
}

/// The middle file-explorer panel: shows the focused terminal's working
/// directory as a navigable tree. Clicking a file opens it in the document
/// panel; clicking a folder expands it. A second, optional browse pane docks
/// below it for pulling files in from elsewhere on disk.
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
                    Button(action: { workspace.newProject() }) {
                        Label("New Project", systemImage: "folder.badge.plus")
                            .font(settings.ui(12, .medium))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(RoundedRectangle(cornerRadius: 8).stroke(Color(theme.border), lineWidth: 1))
                            .foregroundStyle(Color(theme.foreground))
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
    @ObservedObject private var layout = PanelLayout.shared
    @ObservedObject private var reveal = FileReveal.shared
    @State private var root: FileNode?
    @State private var rootPath = ""
    @State private var creatingFolder = false
    @State private var newFolderName = ""
    @State private var watcher = DirectoryWatcher()
    @State private var rootDropTargeted = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    /// The browse pane's open/closed state, persisted against this project.
    private var browseOpen: Bool {
        !rootPath.isEmpty && settings.isBrowseOpen(for: rootPath)
    }

    private var actions: FileTreeActions {
        FileTreeActions(
            onOpenFile: openFile,
            onDropInto: { dest, sources in workspace.copyIntoProject(sources, destination: dest) },
            onCopyToProject: nil,
            onBrowseHere: nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            projectTree
            if browseOpen, !rootPath.isEmpty {
                VerticalResizeHandle(height: $layout.browserHeight, range: 120...520)
                FileBrowserPane(workspace: workspace, projectRoot: rootPath)
                    .frame(height: layout.browserHeight)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(style.background)
        .onAppear { rebuild() }
        .onChange(of: session.projectPath ?? "") { rebuild() }
        .onChange(of: workspace.fileTreeVersion) { rebuild(force: true) }
        .onDisappear { watcher.stop() }
    }

    /// The project tree. Its empty space is itself a drop target, so a file
    /// dragged anywhere that isn't a folder row lands at the project root.
    private var projectTree: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let root, let kids = root.children {
                        ForEach(kids) { node in
                            FileRow(node: node, depth: 0, actions: actions)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }
            .frame(maxHeight: .infinity)
            .onDrop(of: [.fileURL], isTargeted: $rootDropTargeted) { providers in
                guard let root else { return false }
                loadDroppedURLs(providers) { urls in
                    workspace.copyIntoProject(urls, destination: root.url)
                }
                return true
            }
            .overlay {
                if rootDropTargeted {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(settings.actionStyle.color, lineWidth: 1.5)
                        .padding(2)
                }
            }
            // A reveal can arrive before this tree exists (focusing another
            // project's terminal rebuilds the explorer), so check on appear too.
            .onAppear { applyReveal(proxy) }
            .onChange(of: reveal.request) { applyReveal(proxy) }
        }
    }

    /// Open the folders down to the revealed file and scroll it into view. Ignores
    /// reveals aimed at a file outside this tree — another project's explorer will
    /// claim those.
    private func applyReveal(_ proxy: ScrollViewProxy) {
        // No-op unless this tree hasn't been built yet — which is exactly the case
        // when a reveal focused this session's tab to get here.
        guard let request = reveal.request, let root = rebuild() else { return }
        let rootPath = root.url.path
        guard request.url.path == rootPath || request.url.path.hasPrefix(rootPath + "/") else { return }
        guard reveal.claim(request) else { return }
        root.revealDescendant(request.url) { node in
            guard let node, node !== root else { return }
            // Expanding folders re-renders the tree; let the new rows lay out before
            // asking the scroll view to find one of them.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(node.id, anchor: .center)
                }
            }
        }
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
            Button(action: toggleBrowse) {
                Image(systemName: "tray.and.arrow.down")
                    .font(.system(size: 11))
                    .foregroundStyle(browseOpen ? settings.actionStyle.color
                                                : Color(theme.secondaryForeground))
            }
            .buttonStyle(.iconHover(padding: 3))
            .disabled(rootPath.isEmpty)
            .help("Browse other folders — drag files in to add them to the project")
            Button(action: { newFolderName = ""; creatingFolder = true }) {
                Image(systemName: "folder.badge.plus")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.iconHover(padding: 3))
            .help("New folder")
            Button(action: { rebuild(force: true) }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.iconHover(padding: 3))
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

    private func toggleBrowse() {
        guard !rootPath.isEmpty else { return }
        withAnimation(.easeOut(duration: 0.15)) {
            settings.browseOpen[rootPath] = !browseOpen
        }
    }

    private func createFolder() {
        creatingFolder = false
        let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        // The name becomes a single path component — reject anything that could
        // climb out of the project directory.
        guard !name.isEmpty, name != "..", !name.contains("/"), !name.contains("\\"),
              !rootPath.isEmpty else { return }
        let url = URL(fileURLWithPath: rootPath).appendingPathComponent(name)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        rebuild(force: true)
    }

    private var rootName: String {
        let p = rootPath.isEmpty ? (session.projectPath ?? "") : rootPath
        let last = (p as NSString).lastPathComponent
        return last.isEmpty ? "/" : last
    }

    /// Build (or refresh) the tree, returning its root — so a caller acting on the
    /// tree right away doesn't have to re-read the `@State` it just wrote.
    @discardableResult
    private func rebuild(force: Bool = false) -> FileNode? {
        // A session with no project directory has no explorer tree at all (there
        // is deliberately no whole-home fallback).
        guard let path = session.explorerRoot else {
            if root != nil { root = nil; rootPath = ""; watcher.stop() }
            return nil
        }
        // Already showing this folder: a forced call (manual refresh button or a
        // filesystem change) is a refresh-in-place that keeps open folders open;
        // an unforced one is a no-op.
        if let root, path == rootPath {
            if force { root.refresh() }
            return root
        }
        // A different folder (or first build): read it fresh and re-point the
        // filesystem watcher at it.
        rootPath = path
        let node = FileNode(url: URL(fileURLWithPath: path), isDirectory: true)
        node.expanded = true
        node.load()
        root = node
        watcher.start(path: path) { [weak node] _ in node?.refresh() }
        return node
    }

    /// Open a clicked file in the document panel.
    private func openFile(_ url: URL) {
        workspace.viewedFile = url
        workspace.showViewer = true
    }
}

/// The second, subordinate file browser docked beneath the project tree. It can
/// be pointed anywhere on disk; drag a file from it onto a folder in the project
/// tree above to copy it in. Its location is remembered per project.
private struct FileBrowserPane: View {
    @ObservedObject var workspace: Workspace
    /// The open project's folder — the key this pane's location is stored under.
    let projectRoot: String

    @ObservedObject private var settings = AppSettings.shared
    @State private var root: FileNode?
    @State private var rootPath = ""
    @State private var watcher = DirectoryWatcher()

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    private var actions: FileTreeActions {
        FileTreeActions(
            onOpenFile: { url in workspace.viewedFile = url; workspace.showViewer = true },
            onDropInto: nil,
            onCopyToProject: { url in
                guard let dest = workspace.projectRootURL else { NSSound.beep(); return }
                workspace.copyIntoProject([url], destination: dest)
            },
            onBrowseHere: { url in navigate(to: url.path) })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let root, let kids = root.children {
                        ForEach(kids) { node in
                            FileRow(node: node, depth: 0, actions: actions)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .background(style.background)
        .onAppear { navigate(to: settings.browseFolder(for: projectRoot)) }
        .onDisappear { watcher.stop() }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "shippingbox")
                .font(.system(size: 10))
                .foregroundStyle(Color(theme.secondaryForeground))
            Text(displayPath)
                .font(settings.ui(11, .medium))
                .foregroundStyle(Color(theme.foreground))
                .lineLimit(1).truncationMode(.head)
                .help(rootPath)
            Spacer(minLength: 4)
            Button(action: goUp) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.iconHover(padding: 2))
            .disabled(rootPath == "/" || rootPath.isEmpty)
            .help("Enclosing folder")
            Menu {
                ForEach(quickLocations, id: \.path) { loc in
                    Button(loc.name) { navigate(to: loc.path) }
                }
                Divider()
                Button("Choose Folder…") { chooseFolder() }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 16)
            .help("Go to folder")
        }
        .padding(.horizontal, 12).frame(height: 30)
    }

    private var displayPath: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if rootPath == home { return "~" }
        if rootPath.hasPrefix(home) { return "~" + rootPath.dropFirst(home.count) }
        return rootPath
    }

    private struct QuickLocation { let name: String; let path: String }

    private var quickLocations: [QuickLocation] {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        return [("Home", home.path),
                ("Desktop", home.appendingPathComponent("Desktop").path),
                ("Documents", home.appendingPathComponent("Documents").path),
                ("Downloads", home.appendingPathComponent("Downloads").path)]
            .filter { fm.fileExists(atPath: $0.1) }
            .map { QuickLocation(name: $0.0, path: $0.1) }
    }

    private func goUp() {
        let parent = (rootPath as NSString).deletingLastPathComponent
        guard !parent.isEmpty else { return }
        navigate(to: parent)
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Browse"
        panel.message = "Choose a folder to browse for files"
        panel.directoryURL = URL(fileURLWithPath: rootPath)
        if panel.runModal() == .OK, let url = panel.url { navigate(to: url.path) }
    }

    /// Point the pane at `path`, rebuild its tree, and remember it against the
    /// project so returning here later lands back on the same folder.
    private func navigate(to path: String) {
        guard !path.isEmpty, path != rootPath || root == nil else { return }
        rootPath = path
        if settings.browseFolders[projectRoot] != path { settings.browseFolders[projectRoot] = path }
        let node = FileNode(url: URL(fileURLWithPath: path), isDirectory: true)
        node.expanded = true
        node.load()
        root = node
        watcher.start(path: path) { [weak node] _ in node?.refresh() }
    }
}

/// A single row in a file tree; recurses to render expanded folders.
private struct FileRow: View {
    @ObservedObject var node: FileNode
    let depth: Int
    let actions: FileTreeActions
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var reveal = FileReveal.shared
    @State private var hovering = false
    @State private var dropTargeted = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.files, base: 12, background: theme.chrome) }

    /// Only folders in a drop-accepting tree can receive files.
    private var acceptsDrop: Bool { node.isDirectory && actions.onDropInto != nil }

    /// The row an agent pointed at, or the file the user last opened.
    private var isSelected: Bool { reveal.selected == node.standardizedURL }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            droppableRow
            if node.isDirectory, node.expanded, let kids = node.children {
                ForEach(kids) { child in
                    FileRow(node: child, depth: depth + 1, actions: actions)
                }
            }
        }
    }

    @ViewBuilder private var droppableRow: some View {
        if acceptsDrop {
            row.onDrop(of: [.fileURL], isTargeted: $dropTargeted, perform: handleDrop)
        } else {
            row
        }
    }

    private var row: some View {
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
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 4).fill(settings.actionStyle.softFill)
            } else if hovering {
                Color(theme.surface)
            }
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(settings.actionStyle.color, lineWidth: 1.5)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture {
            if node.isDirectory { withAnimation(.easeOut(duration: 0.1)) { node.toggle() } }
            else {
                reveal.select(node.url)
                actions.onOpenFile(node.url)
            }
        }
        .onDrag { NSItemProvider(object: node.url as NSURL) }
        .contextMenu {
            if let copyToProject = actions.onCopyToProject {
                Button {
                    copyToProject(node.url)
                } label: { Label("Copy to Project", systemImage: "tray.and.arrow.down") }
            }
            if node.isDirectory, let browseHere = actions.onBrowseHere {
                Button {
                    browseHere(node.url)
                } label: { Label("Browse Here", systemImage: "arrow.down.forward.square") }
            }
            Button {
                NSWorkspace.shared.activateFileViewerSelecting([node.url])
            } label: { Label("Show in Finder", systemImage: "folder") }
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(node.url.path, forType: .string)
            } label: { Label("Copy Path", systemImage: "doc.on.clipboard") }
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let onDropInto = actions.onDropInto else { return false }
        loadDroppedURLs(providers) { urls in
            guard !urls.isEmpty else { return }
            node.expand()   // reveal what just landed
            onDropInto(node.url, urls)
        }
        return true
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

/// A hairline divider that drags vertically to resize the pane below it — the
/// horizontal counterpart of `WorkspaceView`'s column handle.
private struct VerticalResizeHandle: View {
    @Binding var height: Double
    let range: ClosedRange<Double>
    @ObservedObject private var settings = AppSettings.shared
    @State private var startHeight: Double?

    var body: some View {
        Rectangle()
            .fill(Color(settings.theme.border))
            .frame(height: 1)
            .overlay(
                Color.clear
                    .frame(height: 11)
                    .contentShape(Rectangle())
                    .onHover { h in
                        if h { NSCursor.resizeUpDown.set() } else { NSCursor.arrow.set() }
                    }
                    .gesture(
                        // `.global` for the same reason as the column handle: in `.local`
                        // the handle rides the pane it resizes, so its translation feeds
                        // back on itself and the pane judders between two heights.
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { v in
                                if startHeight == nil {
                                    startHeight = height
                                    LiveResizeMonitor.shared.beginPanelDrag()
                                }
                                let s = startHeight ?? height
                                // Dragging up grows the pane below. Snap to whole
                                // points so sub-pixel mouse deltas don't relayout.
                                let next = (s - v.translation.height).rounded()
                                let clamped = min(range.upperBound, max(range.lowerBound, next))
                                if clamped != height { height = clamped }
                            }
                            .onEnded { _ in endDrag() }
                    )
            )
            .onDisappear { endDrag() }
    }

    private func endDrag() {
        guard startHeight != nil else { return }
        startHeight = nil
        LiveResizeMonitor.shared.endPanelDrag()
        PanelLayout.shared.persist()
    }
}
