import SwiftUI

/// The themed document panel — edits the open file, or offers to create a new
/// markdown doc when nothing is open. Sits between the file explorer and the
/// terminal/chat.
struct FileViewerPanel: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    /// Live meeting-capture state (shared singleton so a recording survives this
    /// view being rebuilt when the user switches files).
    @ObservedObject private var recorder = RecordingSessionManager.shared
    @State private var content = ""
    @State private var message: String?
    @State private var dirty = false
    @State private var loadedURL: URL?
    @State private var creating = false
    @State private var newName = ""
    /// Markdown files default to a styled preview; this flips to the raw editor.
    @State private var editingMarkdown = false
    /// Brief "attached" confirmation on the Use-as-context button.
    @State private var contextConfirm = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.doc, base: CGFloat(settings.fontSize), background: theme.background) }
    /// A markdown file we can render as a styled preview (vs. raw text editing).
    private var isMarkdown: Bool { (loadedURL ?? workspace.viewedFile)?.pathExtension.lowercased() == "md" }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            recordingBar
            documentBody(workspace.viewedFile)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(style.background)
        .onChange(of: workspace.viewedFile) { load() }
        .onChange(of: recorder.pendingTranscript) { dropInPendingTranscript() }
        .onAppear { load(); dropInPendingTranscript() }
        .sheet(isPresented: $creating) { newDocSheet }
    }

    @ViewBuilder
    private func documentBody(_ file: URL?) -> some View {
        if let message {
            centeredMessage(message, icon: "doc")
        } else if file != nil, isMarkdown, !editingMarkdown {
            // Styled, read-only render of the markdown (headings, bold, lists,
            // code). Tap the pencil in the header to drop to the raw editor.
            ScrollView {
                MarkdownText(text: content, baseSize: CGFloat(settings.fontSize))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .background(style.background)
        } else if file != nil {
            TextEditor(text: $content)
                .font(style.font(CGFloat(settings.fontSize)))
                .foregroundStyle(style.textColor)
                .lineSpacing(style.lineSpacing)
                .scrollContentBackground(.hidden)
                .background(style.background)
                .padding(6)
                .onChange(of: content) { if loadedURL != nil { dirty = true } }
        } else {
            // No document open — offer to create one.
            VStack(spacing: 14) {
                Spacer()
                Image(systemName: "doc.badge.plus").font(.system(size: 34))
                    .foregroundStyle(Color(theme.secondaryForeground))
                Text("No document open").font(settings.ui(13)).foregroundStyle(Color(theme.secondaryForeground))
                Button(action: startCreate) {
                    Label("New markdown document", systemImage: "plus")
                        .font(settings.ui(12, .medium))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8).fill(settings.actionStyle.fill))
                        .foregroundStyle(.white)
                }.buttonStyle(.plain)
                Spacer()
            }.frame(maxWidth: .infinity)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text").font(.system(size: 11)).foregroundStyle(Color(theme.accent))
            Text(workspace.viewedFile?.lastPathComponent ?? "Document")
                .font(settings.ui(12, .semibold))
                .foregroundStyle(Color(theme.foreground))
                .lineLimit(1).truncationMode(.middle)
            if dirty { Circle().fill(Color(theme.accent)).frame(width: 5, height: 5) }
            Spacer()
            if workspace.viewedFile != nil, message == nil {
                recordControl
                Button(action: useAsContext) {
                    Image(systemName: contextConfirm ? "checkmark" : "text.bubble")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(contextConfirm ? theme.accent : theme.secondaryForeground))
                .help("Use as context in the active chat")
            }
            if workspace.viewedFile != nil, isMarkdown, message == nil {
                Button(action: { editingMarkdown.toggle() }) {
                    Image(systemName: editingMarkdown ? "eye" : "pencil").font(.system(size: 11))
                }
                .buttonStyle(.plain).foregroundStyle(Color(theme.secondaryForeground))
                .help(editingMarkdown ? "Preview" : "Edit raw markdown")
            }
            if workspace.viewedFile != nil {
                Button(action: save) { Image(systemName: "square.and.arrow.down").font(.system(size: 11)) }
                    .buttonStyle(.plain).foregroundStyle(Color(dirty ? theme.accent : theme.secondaryForeground))
                    .help("Save (⌘S)").keyboardShortcut("s", modifiers: .command).disabled(!dirty)
                Button(action: startCreate) { Image(systemName: "plus").font(.system(size: 11)) }
                    .buttonStyle(.plain).foregroundStyle(Color(theme.secondaryForeground)).help("New document")
            }
            Button(action: { save(); workspace.showViewer = false }) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain).help("Close")
        }
        .padding(.horizontal, 12).frame(height: 34)
    }

    /// Record / Stop control with a live elapsed timer while recording, and a
    /// quiet spinner while the finished audio is being transcribed.
    @ViewBuilder
    private var recordControl: some View {
        let active = recorder.isActive(for: workspace.viewedFile)
        if active, recorder.isRecording {
            Button(action: toggleRecord) {
                HStack(spacing: 4) {
                    RecordingDot()
                    Text(elapsedString)
                        .font(settings.ui(11, .semibold).monospacedDigit())
                    Image(systemName: "stop.fill").font(.system(size: 10))
                }
                .foregroundStyle(Color(theme.accent))
            }
            .buttonStyle(.plain)
            .help("Stop recording and drop the transcript in")
        } else if active, recorder.state == .transcribing {
            HStack(spacing: 4) {
                ProgressView().controlSize(.small).scaleEffect(0.7)
                Text("Transcribing…").font(settings.ui(11))
            }
            .foregroundStyle(Color(theme.secondaryForeground))
        } else {
            Button(action: toggleRecord) {
                Image(systemName: "mic.fill").font(.system(size: 11))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color(theme.secondaryForeground))
            .disabled(recorder.isBusy)   // a recording is already running elsewhere
            .help(recorder.isBusy ? "Recording in another document" : "Record a meeting into this document")
        }
    }

    /// A full-width status strip below the toolbar showing recording /
    /// transcribing / error state. Lives in the layout (not an overlay) so it
    /// never sits on top of the notes — content flows beneath it.
    @ViewBuilder
    private var recordingBar: some View {
        if recorder.isActive(for: workspace.viewedFile), recorder.state != .idle {
            VStack(spacing: 0) {
                HStack(spacing: 7) { recordingBarContent }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                Rectangle().fill(Color(theme.border)).frame(height: 1)
            }
            .background(Color(theme.background))
            .background(Color(theme.foreground).opacity(0.05))
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    @ViewBuilder
    private var recordingBarContent: some View {
        switch recorder.state {
        case .recording:
            RecordingDot()
            Text("Recording · \(elapsedString)")
                .font(settings.ui(11, .semibold).monospacedDigit())
                .foregroundStyle(Color(theme.foreground))
            Text("keep typing your notes — the transcript drops in when you stop")
                .font(settings.ui(11)).foregroundStyle(Color(theme.secondaryForeground))
                .lineLimit(1).truncationMode(.tail)
        case .transcribing:
            ProgressView().controlSize(.small).scaleEffect(0.7)
            Text(recorder.detail ?? "Transcribing on-device…")
                .font(settings.ui(11)).foregroundStyle(Color(theme.foreground))
                .lineLimit(1).truncationMode(.tail)
        case .error(let msg):
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10)).foregroundStyle(.orange)
            Text(msg).font(settings.ui(11)).foregroundStyle(Color(theme.foreground)).lineLimit(2)
            Spacer(minLength: 6)
            Button("Dismiss") { recorder.clearError() }
                .buttonStyle(.plain).font(settings.ui(11, .semibold))
                .foregroundStyle(Color(theme.accent))
        case .idle:
            EmptyView()
        }
    }

    private var elapsedString: String { TranscriptFormatter.timestamp(recorder.elapsed) }

    private var newDocSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Document").font(settings.ui(15, .semibold))
            TextField("Name (e.g. notes.md)", text: $newName)
                .textFieldStyle(.roundedBorder).frame(width: 280)
                .onSubmit(commitCreate)
            HStack {
                Spacer()
                Button("Cancel") { creating = false }
                Button("Create") { commitCreate() }.keyboardShortcut(.defaultAction)
            }
        }.padding(20)
    }

    private func centeredMessage(_ text: String, icon: String) -> some View {
        VStack {
            Spacer()
            Image(systemName: icon).font(.system(size: 30)).foregroundStyle(Color(theme.secondaryForeground))
            Text(text).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                .multilineTextAlignment(.center).padding(.top, 6)
            Spacer()
        }.frame(maxWidth: .infinity)
    }

    private func startCreate() { newName = ""; creating = true }
    private func commitCreate() {
        creating = false
        workspace.createDocument(named: newName)
    }

    private func load() {
        // Save any pending edits to the previously-open file first.
        if dirty, let prev = loadedURL { try? content.write(to: prev, atomically: true, encoding: .utf8) }
        dirty = false
        editingMarkdown = false   // a freshly opened doc starts in preview
        guard let url = workspace.viewedFile else { content = ""; message = nil; loadedURL = nil; return }
        do {
            let data = try Data(contentsOf: url)
            if data.count > 2_000_000 { message = "File too large to edit (\(data.count / 1024) KB)."; loadedURL = nil; return }
            if let s = String(data: data, encoding: .utf8) {
                content = s; message = nil; loadedURL = url
            } else { message = "Can't edit this file (binary or non-text)."; loadedURL = nil }
        } catch { message = "Couldn't read this file."; loadedURL = nil }
    }

    private func save() {
        guard dirty, let url = loadedURL else { return }
        try? content.write(to: url, atomically: true, encoding: .utf8)
        dirty = false
    }

    // MARK: - Meeting capture

    /// Start recording into the open document, or stop the one in progress.
    private func toggleRecord() {
        guard let url = workspace.viewedFile else { return }
        recorder.clearError()
        recorder.toggle(documentURL: url)
    }

    /// Attach the (saved) document to the focused chat session so the agent can
    /// use it as context. Reuses the composer's existing attachment mechanism —
    /// the chat shows a chip the user can detach, and Claude reads the file on
    /// demand rather than the whole thing being pasted in.
    private func useAsContext() {
        guard let url = loadedURL ?? workspace.viewedFile else { return }
        save()
        guard let session = workspace.focusedSession else { NSSound.beep(); return }
        if !session.pendingAttachments.contains(url) {
            session.pendingAttachments.append(url)
        }
        contextConfirm = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { contextConfirm = false }
    }

    /// When a finished transcript is waiting, merge it into its document.
    private func dropInPendingTranscript() {
        guard let markdown = recorder.pendingTranscript, let target = recorder.targetURL else { return }
        let open = (loadedURL ?? workspace.viewedFile)?.standardizedFileURL
        if open == target.standardizedFileURL {
            // The transcript's document is the one open in the editor: merge into
            // the live buffer so any unsaved typed notes are preserved, then save.
            if !content.isEmpty, !content.hasSuffix("\n") { content += "\n" }
            content += markdown
            dirty = true
            save()
        } else {
            // The user has moved on to another file — append to the target on disk.
            var existing = (try? String(contentsOf: target, encoding: .utf8)) ?? ""
            if !existing.isEmpty, !existing.hasSuffix("\n") { existing += "\n" }
            existing += markdown
            try? existing.write(to: target, atomically: true, encoding: .utf8)
            workspace.fileTreeVersion += 1
        }
        recorder.pendingTranscript = nil
    }
}

/// A softly pulsing red dot — the recording indicator.
private struct RecordingDot: View {
    @State private var bright = false
    var body: some View {
        Circle()
            .fill(Color.red)
            .frame(width: 8, height: 8)
            .opacity(bright ? 1 : 0.3)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) {
                    bright = true
                }
            }
    }
}
