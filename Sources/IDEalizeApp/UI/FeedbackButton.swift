import SwiftUI
import AppKit

/// "Give feedback" — opens a quick text box; entries are appended to a local
/// backlog file for automated review.
struct FeedbackButton: View {
    @ObservedObject private var settings = AppSettings.shared
    @State private var presenting = false
    @State private var text = ""
    @State private var sent = false

    private var theme: Theme { settings.theme }

    var body: some View {
        Button(action: { text = ""; sent = false; presenting = true }) {
            HStack(spacing: 5) {
                Image(systemName: "exclamationmark.bubble").font(.system(size: 10))
                Text("Feedback").font(settings.ui(11, .medium))
            }
            .foregroundStyle(Color(theme.secondaryForeground))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Capsule().fill(Color(theme.surface)))
            .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help("Give feedback")
        .sheet(isPresented: $presenting) { sheet }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Give feedback").font(settings.ui(16, .semibold))
            Text("What's working, what's not, or what you'd like next. Goes to the IDEalize backlog.")
                .font(settings.ui(11)).foregroundStyle(.secondary)
            TextEditor(text: $text)
                .font(settings.ui(13))
                .frame(width: 440, height: 170)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color(theme.border)))
            HStack {
                if sent {
                    Label("Sent — thank you!", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green).font(settings.ui(11))
                }
                Spacer()
                Button("Cancel") { presenting = false }
                Button("Send") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
    }

    private func submit() {
        Feedback.save(text)
        sent = true
        text = ""
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { presenting = false }
    }
}

enum Feedback {
    // The IDEalize feedback Supabase project. The publishable key is safe to
    // embed: a row-level-security policy allows INSERT only (no reads), so the
    // app can submit feedback but never see anyone else's.
    private static let endpoint = "https://xlswtyprnmiymfjdbaez.supabase.co/rest/v1/idealize_feedback"
    private static let publishableKey = "sb_publishable_ISmJRrzDN3Z6OEdEEZe2Cw_5YvSDGkt"

    /// Send the feedback to Supabase, and keep a local backup copy.
    static func save(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        submit(text)
        appendLocal(text)
    }

    /// POST one feedback row to Supabase (anonymous, insert-only).
    private static func submit(_ text: String) {
        guard let url = URL(string: endpoint) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(publishableKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(publishableKey)", forHTTPHeaderField: "Authorization")
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        let payload: [String: Any] = [
            "text": text,
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
            "os_version": ProcessInfo.processInfo.operatingSystemVersionString,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        URLSession.shared.dataTask(with: req) { _, response, error in
            if let error {
                NSLog("IDEalize feedback: send failed — \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                NSLog("IDEalize feedback: server returned HTTP \(http.statusCode)")
            }
        }.resume()
    }

    /// Append a timestamped entry to the local backup file.
    private static func appendLocal(_ text: String) {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/IDEalize", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("feedback.md")
        let stamp = ISO8601DateFormatter().string(from: Date())
        let entry = "\n## \(stamp)\n\(text)\n"
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(entry.utf8))
            try? handle.close()
        } else {
            try? ("# IDEalize Feedback\n" + entry).write(to: file, atomically: true, encoding: .utf8)
        }
    }
}
