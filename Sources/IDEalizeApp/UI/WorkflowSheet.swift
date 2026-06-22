import SwiftUI

/// Prompts for a workflow's parameters before running it.
struct WorkflowSheet: View {
    let workflow: Workflow
    @ObservedObject var workspace: Workspace
    @State private var values: [String: String] = [:]

    private var params: [String] { workflow.detectedParameters }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "wand.and.stars").foregroundStyle(.tint)
                Text(workflow.name).font(.headline)
            }
            if let desc = workflow.description {
                Text(desc).font(.caption).foregroundStyle(.secondary)
            }
            Form {
                ForEach(params, id: \.self) { p in
                    TextField(placeholder(for: p), text: binding(for: p))
                        .textFieldStyle(.roundedBorder)
                }
            }
            .formStyle(.grouped)

            Text(preview)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.gray.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))

            HStack {
                Spacer()
                Button("Cancel") { workspace.pendingWorkflow = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Run") { workspace.finishWorkflow(workflow, values: values) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 460)
        .onAppear {
            for p in params where values[p] == nil {
                values[p] = workflow.parameters.first { $0.name == p }?.defaultValue ?? ""
            }
        }
    }

    private var preview: String { workflow.resolved(with: values) }

    private func placeholder(for p: String) -> String {
        workflow.parameters.first { $0.name == p }?.placeholder ?? p
    }

    private func binding(for p: String) -> Binding<String> {
        Binding(get: { values[p] ?? "" }, set: { values[p] = $0 })
    }
}
