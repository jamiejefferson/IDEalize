import SwiftUI

/// Manage saved workflows: add, edit, delete.
struct WorkflowsSettings: View {
    @ObservedObject var store = WorkflowStore.shared
    @State private var editing: Workflow?
    @State private var isNew = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Workflows").font(.headline)
                Spacer()
                Button {
                    editing = Workflow(name: "", command: "", description: nil, parameters: [])
                    isNew = true
                } label: { Image(systemName: "plus") }
            }
            List {
                ForEach(store.workflows) { wf in
                    HStack {
                        Image(systemName: "wand.and.stars").foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(wf.name)
                            Text(wf.command).font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Button { editing = wf; isNew = false } label: { Image(systemName: "pencil") }
                            .buttonStyle(.plain)
                        Button { store.remove(wf) } label: { Image(systemName: "trash") }
                            .buttonStyle(.plain).foregroundStyle(.red)
                    }
                }
            }
        }
        .sheet(item: $editing) { wf in
            WorkflowEditor(workflow: wf, isNew: isNew) { saved in
                if isNew { store.add(saved) } else { store.update(saved) }
                editing = nil
            } onCancel: { editing = nil }
        }
    }
}

private struct WorkflowEditor: View {
    @State var workflow: Workflow
    let isNew: Bool
    let onSave: (Workflow) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(isNew ? "New Workflow" : "Edit Workflow").font(.headline)
            Form {
                TextField("Name", text: $workflow.name)
                TextField("Command", text: $workflow.command)
                    .font(.system(.body, design: .monospaced))
                TextField("Description", text: Binding(
                    get: { workflow.description ?? "" },
                    set: { workflow.description = $0.isEmpty ? nil : $0 }))
            }
            .formStyle(.grouped)
            Text("Use {{name}} for parameters — you'll be prompted when running.")
                .font(.caption).foregroundStyle(.secondary)
            let detected = workflow.detectedParameters
            if !detected.isEmpty {
                Text("Parameters: " + detected.joined(separator: ", "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Cancel", action: onCancel).keyboardShortcut(.cancelAction)
                Button("Save") {
                    // Ensure parameter records exist for detected placeholders.
                    var wf = workflow
                    wf.parameters = detected.map { name in
                        wf.parameters.first { $0.name == name }
                            ?? Workflow.Parameter(name: name, defaultValue: nil, placeholder: name)
                    }
                    onSave(wf)
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(workflow.name.isEmpty || workflow.command.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}
