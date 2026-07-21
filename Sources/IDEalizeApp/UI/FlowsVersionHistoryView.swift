import SwiftUI

/// Browse, restore, and compare saved versions of the working flow. Every
/// significant edit creates a snapshot, so users can experiment without fear.
struct FlowsVersionHistoryView: View {
    @ObservedObject var flowStore: FlowStore
    /// Fires when the user closes the history.
    var onClose: () -> Void = {}
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }
    @State private var versions: [FlowVersion] = []
    @State private var selected: FlowVersion?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if versions.isEmpty {
                emptyState
            } else {
                HStack(spacing: 0) {
                    versionList
                    Rectangle().fill(Color(theme.border)).frame(width: 1)
                    detailPane
                }
            }
        }
        .frame(width: 560, height: 420)
        .background(Color(theme.chrome))
        .onAppear(perform: reload)
    }

    private var header: some View {
        HStack {
            Text("VERSION HISTORY")
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

    private var versionList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(versions) { version in
                    VersionRow(version: version,
                               isSelected: selected?.id == version.id,
                               onSelect: { selected = version },
                               onRestore: { restore(version) },
                               onDelete: { delete(version) })
                }
            }
            .padding(.vertical, 4)
        }
        .frame(width: 220)
    }

    private var detailPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let version = selected {
                Text(version.snapshot.title)
                    .font(settings.ui(14, .semibold))
                    .foregroundStyle(Color(theme.foreground))
                Text(version.note)
                    .font(settings.ui(11))
                    .foregroundStyle(Color(theme.secondaryForeground))
                Text(version.createdAt)
                    .font(settings.ui(10))
                    .foregroundStyle(Color(theme.secondaryForeground).opacity(0.8))

                Divider()

                if let current = diffSummary(from: version.snapshot, to: flowStore.flow) {
                    Text("Compared to now")
                        .font(settings.ui(10, .semibold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                    Text(current)
                        .font(settings.ui(11))
                        .foregroundStyle(Color(theme.foreground))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("No differences from the current flow.")
                        .font(settings.ui(11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }

                Spacer()
            } else {
                Text("Select a version to preview it")
                    .font(settings.ui(12))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 26))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.5))
            Text("No versions yet")
                .font(settings.ui(12))
                .foregroundStyle(Color(theme.secondaryForeground))
            Text("Save a flow or confirm a stage to create your first version.")
                .font(settings.ui(11))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.8))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: - Data

    private func reload() {
        versions = flowStore.versions()
        selected = versions.first
    }

    private func restore(_ version: FlowVersion) {
        flowStore.restore(version: version)
        onClose()
    }

    private func delete(_ version: FlowVersion) {
        flowStore.deleteVersion(id: version.id)
        reload()
    }

    /// A plain-English summary of what changed between two flows.
    private func diffSummary(from old: Flow, to new: Flow) -> String? {
        var changes: [String] = []
        if old.title != new.title { changes.append("Title changed") }
        let oldStages = old.flow.stages ?? []
        let newStages = new.flow.stages ?? []
        if oldStages.count != newStages.count {
            changes.append("\(abs(newStages.count - oldStages.count)) stage(s) \(newStages.count > oldStages.count ? "added" : "removed")")
        } else {
            for (o, n) in zip(oldStages, newStages) where o.title != n.title || o.text != n.text {
                changes.append("Stage “\(n.title)” edited")
                break
            }
        }
        if old.resolvedMetadata.description != new.resolvedMetadata.description {
            changes.append("Description updated")
        }
        return changes.isEmpty ? nil : changes.joined(separator: " · ")
    }
}

/// One row in the version list.
private struct VersionRow: View {
    let version: FlowVersion
    let isSelected: Bool
    var onSelect: () -> Void
    var onRestore: () -> Void
    var onDelete: () -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(version.note.isEmpty ? "Snapshot" : version.note)
                    .font(settings.ui(11, .medium))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(1)
                Text(version.createdAt.prefix(16).replacingOccurrences(of: "T", with: " "))
                    .font(settings.ui(9))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            Spacer(minLength: 4)
            if hovering {
                HStack(spacing: 6) {
                    Button("Restore", action: onRestore)
                        .font(settings.ui(9, .medium))
                    Button("Delete", action: onDelete)
                        .font(settings.ui(9, .medium))
                        .foregroundStyle(.red)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(isSelected ? settings.actionStyle.color.opacity(0.10) : (hovering ? Color(theme.surfaceHover).opacity(0.5) : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture(perform: onSelect)
    }
}
