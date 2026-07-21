import SwiftUI

/// The full Flows Library: a collection of saved, reusable workflows with
/// metadata, search, and actions. Designed to feel like a shelf of playbooks
/// rather than a file picker.
struct FlowsLibraryView: View {
    @ObservedObject var flowStore: FlowStore
    /// Fires when the user chooses to run a flow.
    var onRun: (SavedFlowRef) -> Void = { _ in }
    /// Fires when the user chooses to edit a flow (loads it into the designer).
    var onEdit: (SavedFlowRef) -> Void = { _ in }
    /// Fires when the user closes the library.
    var onClose: () -> Void = {}
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }
    @State private var query = ""
    @State private var saved: [SavedFlowRef] = []
    @State private var flowsByURL: [String: Flow] = [:]

    private var filtered: [SavedFlowRef] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return saved }
        return saved.filter { ref in
            let flow = flowsByURL[ref.url.path]
            return ref.title.lowercased().contains(q)
                || (flow?.resolvedMetadata.description.lowercased().contains(q) ?? false)
                || (flow?.resolvedMetadata.tags.contains { $0.lowercased().contains(q) } ?? false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            searchBar
            Divider()
            if filtered.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(filtered) { ref in
                            LibraryRow(ref: ref,
                                       flow: flowsByURL[ref.url.path],
                                       onRun: { onRun(ref) },
                                       onEdit: { onEdit(ref) },
                                       onDuplicate: { duplicate(ref) },
                                       onArchive: { archive(ref) },
                                       onDelete: { delete(ref) })
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .frame(width: 380, height: 480)
        .background(Color(theme.chrome))
        .onAppear(perform: reload)
    }

    private var header: some View {
        HStack {
            Text("FLOWS LIBRARY")
                .font(settings.ui(9, .semibold)).tracking(0.8)
                .foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
    }

    private var searchBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(Color(theme.secondaryForeground))
            TextField("Search flows, tags, or descriptions", text: $query)
                .textFieldStyle(.plain)
                .font(settings.ui(12))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray")
                .font(.system(size: 26))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.5))
            Text(query.isEmpty ? "No saved flows yet" : "No flows match your search")
                .font(settings.ui(12))
                .foregroundStyle(Color(theme.secondaryForeground))
            if query.isEmpty {
                Text("Design a flow in the Flows view and save it here.")
                    .font(settings.ui(11))
                    .foregroundStyle(Color(theme.secondaryForeground).opacity(0.8))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: - Data

    private func reload() {
        saved = flowStore.savedFlows()
        var map: [String: Flow] = [:]
        for ref in saved {
            if let data = try? Data(contentsOf: ref.url),
               let flow = try? JSONDecoder().decode(Flow.self, from: data) {
                map[ref.url.path] = flow
            }
        }
        flowsByURL = map
    }

    private func duplicate(_ ref: SavedFlowRef) {
        flowStore.duplicateSaved(ref)
        reload()
    }

    private func archive(_ ref: SavedFlowRef) {
        flowStore.archiveSaved(ref)
        reload()
    }

    private func delete(_ ref: SavedFlowRef) {
        flowStore.deleteSaved(ref)
        reload()
    }
}

/// One row in the library: title, metadata, and action buttons.
private struct LibraryRow: View {
    let ref: SavedFlowRef
    let flow: Flow?
    var onRun: () -> Void
    var onEdit: () -> Void
    var onDuplicate: () -> Void
    var onArchive: () -> Void
    var onDelete: () -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    @State private var confirmDelete = false
    private var theme: Theme { settings.theme }

    private var meta: FlowMetadata { flow?.resolvedMetadata ?? FlowMetadata() }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(ref.title)
                        .font(settings.ui(13, .semibold))
                        .foregroundStyle(Color(theme.foreground))
                        .lineLimit(1)
                    if !meta.description.isEmpty {
                        Text(meta.description)
                            .font(settings.ui(11))
                            .foregroundStyle(Color(theme.secondaryForeground))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 8) {
                        Label("v\(meta.version)", systemImage: "number")
                            .font(settings.ui(9, .medium))
                        if !meta.lastEdited.isEmpty {
                            Label(meta.lastEdited.prefix(10), systemImage: "clock")
                                .font(settings.ui(9, .medium))
                        }
                        if !meta.tags.isEmpty {
                            Label(meta.tags.joined(separator: ", "), systemImage: "tag")
                                .font(settings.ui(9, .medium))
                                .lineLimit(1)
                        }
                    }
                    .foregroundStyle(Color(theme.secondaryForeground))
                }
                Spacer(minLength: 8)
            }

            if hovering {
                HStack(spacing: 10) {
                    action("play.fill", "Run", onRun)
                    action("pencil", "Edit", onEdit)
                    action("doc.on.doc", "Duplicate", onDuplicate)
                    action("archivebox", "Archive", onArchive)
                    Spacer()
                    if confirmDelete {
                        Button("Confirm delete") { onDelete() }
                            .font(settings.ui(10, .medium))
                            .foregroundStyle(.red)
                    } else {
                        action("trash", "Delete") { confirmDelete = true }
                            .foregroundStyle(.red)
                    }
                }
                .font(settings.ui(10, .medium))
                .foregroundStyle(settings.actionStyle.color)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(hovering ? Color(theme.surfaceHover).opacity(0.5) : .clear)
        .contentShape(Rectangle())
        .onHover { hovering = $0; if !hovering { confirmDelete = false } }
    }

    private func action(_ icon: String, _ label: String, _ handler: @escaping () -> Void) -> some View {
        Button(action: handler) {
            Label(label, systemImage: icon)
        }
        .buttonStyle(.plain)
    }
}
