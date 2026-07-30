import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// "Give feedback" — opens a quick text box; entries are appended to a local
/// backlog file for automated review.
struct FeedbackButton: View {
    @ObservedObject private var settings = AppSettings.shared
    @State private var presenting = false
    @State private var text = ""
    @State private var sent = false
    @State private var hovering = false
    @State private var screenshot: NSImage?
    @State private var attachHovering = false
    @State private var removeHovering = false
    @State private var dropTargeted = false
    @State private var pasteMonitor: Any?

    private var theme: Theme { settings.theme }

    var body: some View {
        Button(action: { text = ""; sent = false; screenshot = nil; presenting = true }) {
            HStack(spacing: 5) {
                Image(systemName: "exclamationmark.bubble").font(.system(size: 10))
                Text("Feedback").font(settings.ui(11, .medium))
            }
            .foregroundStyle(Color(theme.secondaryForeground))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Capsule().fill(Color(hovering ? theme.surfaceHover : theme.surface)))
            .overlay(Capsule().strokeBorder(
                hovering ? settings.actionStyle.color.opacity(0.5) : Color(theme.border), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
        .help("Tell us what you think — it goes straight to the team")
        .sheet(isPresented: $presenting) { sheet }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Give feedback").font(settings.ui(16, .semibold))
                .foregroundStyle(Color(theme.foreground))
            Text("What's working, what's not, or what you'd like next. Goes to the IDEalize backlog.")
                .font(settings.ui(11)).foregroundStyle(Color(theme.secondaryForeground))
            TextEditor(text: $text)
                .font(settings.ui(13))
                .foregroundStyle(Color(theme.foreground))
                .frame(width: 440, height: 170)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color(theme.border)))
            attachmentRow
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
        .background(Color(theme.chrome))
        // A dropped image (or image file) anywhere on the sheet becomes the
        // attachment; the action-coloured ring shows the sheet is a live target.
        .onDrop(of: [.image, .fileURL], isTargeted: $dropTargeted) { handleDrop($0) }
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(settings.actionStyle.color.opacity(dropTargeted ? 0.8 : 0), lineWidth: 2)
                .padding(4)
                .allowsHitTesting(false)
        )
        // The sheet's window follows the *system* appearance, not the app theme,
        // so pin the scheme to the theme: label colours, button bezels and the
        // TextEditor's typed text then resolve against the themed background.
        .environment(\.colorScheme, theme.isDark ? .dark : .light)
        .onAppear { installPasteMonitor() }
        .onDisappear {
            removePasteMonitor()
            screenshot = nil
        }
    }

    /// Screenshot attachment: either the attach button (+ drag/paste hint), or a
    /// thumbnail of the attached image with a remove (×) control.
    @ViewBuilder private var attachmentRow: some View {
        if let shot = screenshot {
            HStack(alignment: .center, spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    Image(nsImage: shot)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: 120, maxHeight: 68)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(theme.border)))
                    Button(action: { screenshot = nil }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(
                                removeHovering ? settings.actionStyle.color : Color(theme.foreground),
                                Color(theme.chrome))
                    }
                    .buttonStyle(.plain)
                    .onHover { removeHovering = $0 }
                    .offset(x: 7, y: -7)
                    .help("Remove screenshot")
                }
                .padding(.top, 7) // room for the offset × button inside the sheet
                Text("Screenshot attached — it'll be sent with your note.")
                    .font(settings.ui(11))
                    .foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
            }
        } else {
            HStack(spacing: 8) {
                Button(action: pickScreenshot) {
                    HStack(spacing: 5) {
                        Image(systemName: "paperclip")
                            .font(.system(size: 10))
                            .foregroundStyle(settings.actionStyle.color)
                        Text("Attach screenshot")
                            .font(settings.ui(11, .medium))
                            .foregroundStyle(Color(theme.secondaryForeground))
                    }
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(Capsule().fill(Color(attachHovering ? theme.surfaceHover : theme.surface)))
                    .overlay(Capsule().strokeBorder(
                        attachHovering ? settings.actionStyle.color.opacity(0.5) : Color(theme.border),
                        lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .onHover { attachHovering = $0 }
                .animation(.easeOut(duration: 0.12), value: attachHovering)
                .help("Pick an image file to send with your feedback")
                Text("or drop an image here / paste with ⌘V")
                    .font(settings.ui(10))
                    .foregroundStyle(Color(theme.secondaryForeground).opacity(0.8))
                Spacer()
            }
        }
    }

    /// File-picker route: images only.
    private func pickScreenshot() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a screenshot to attach to your feedback"
        panel.begin { response in
            guard response == .OK, let url = panel.url, let image = NSImage(contentsOf: url) else { return }
            DispatchQueue.main.async { screenshot = image }
        }
    }

    /// Drag-and-drop route: accept a dragged image, or an image file from Finder.
    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        if let provider = providers.first(where: { $0.canLoadObject(ofClass: NSImage.self) }) {
            _ = provider.loadObject(ofClass: NSImage.self) { object, _ in
                guard let image = object as? NSImage else { return }
                DispatchQueue.main.async { screenshot = image }
            }
            return true
        }
        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                var url: URL?
                if let data = item as? Data { url = URL(dataRepresentation: data, relativeTo: nil) }
                else if let itemURL = item as? URL { url = itemURL }
                guard let url, let image = NSImage(contentsOf: url) else { return }
                DispatchQueue.main.async { screenshot = image }
            }
            return true
        }
        return false
    }

    /// Paste route: while the sheet is up, ⌘V with an image on the clipboard
    /// attaches it; ⌘V with text falls through to the focused text editor.
    private func installPasteMonitor() {
        guard pasteMonitor == nil else { return }
        pasteMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
                  event.charactersIgnoringModifiers?.lowercased() == "v",
                  let image = Self.imageFromPasteboard()
            else { return event }
            screenshot = image
            return nil // consumed
        }
    }

    private func removePasteMonitor() {
        if let monitor = pasteMonitor { NSEvent.removeMonitor(monitor) }
        pasteMonitor = nil
    }

    /// An image on the general pasteboard: raw image data (e.g. a fresh macOS
    /// screenshot) or a copied image file. Plain text is left for normal paste.
    private static func imageFromPasteboard() -> NSImage? {
        let pasteboard = NSPasteboard.general
        let imageTypes = [UTType.png.identifier, UTType.tiff.identifier, UTType.jpeg.identifier]
        if pasteboard.canReadItem(withDataConformingToTypes: imageTypes) {
            return NSImage(pasteboard: pasteboard)
        }
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true,
                      .urlReadingContentsConformToTypes: [UTType.image.identifier]]) as? [URL],
           let url = urls.first {
            return NSImage(contentsOf: url)
        }
        return nil
    }

    private func submit() {
        Feedback.save(text, screenshot: screenshot)
        sent = true
        text = ""
        screenshot = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { presenting = false }
    }
}

enum Feedback {
    // The IDEalize feedback Supabase project. The publishable key is safe to
    // embed: a row-level-security policy allows INSERT only (no reads), so the
    // app can submit feedback but never see anyone else's.
    private static let endpoint = "https://xlswtyprnmiymfjdbaez.supabase.co/rest/v1/idealize_feedback"
    private static let publishableKey = "sb_publishable_ISmJRrzDN3Z6OEdEEZe2Cw_5YvSDGkt"

    /// The screenshot column has a CHECK of max 2,000,000 characters; stay
    /// comfortably under it after base64 expansion.
    private static let maxScreenshotB64Characters = 1_900_000

    /// Send the feedback to Supabase, and keep a local backup copy. The
    /// optional screenshot is downscaled + JPEG-encoded off the main thread.
    static func save(_ raw: String, screenshot: NSImage? = nil) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        DispatchQueue.global(qos: .utility).async {
            let jpeg = screenshot.flatMap { encodeScreenshot($0) }
            submit(text, screenshotJPEG: jpeg)
            appendLocal(text, screenshotJPEG: jpeg)
        }
    }

    /// Downscale so the longest side is ≤1600px and encode as JPEG, starting at
    /// quality 0.7 and stepping down until the base64 form fits the column limit.
    private static func encodeScreenshot(_ image: NSImage) -> Data? {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              cgImage.width > 0, cgImage.height > 0 else { return nil }
        let scale = min(1, 1600 / CGFloat(max(cgImage.width, cgImage.height)))
        let width = max(1, Int(CGFloat(cgImage.width) * scale))
        let height = max(1, Int(CGFloat(cgImage.height) * scale))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                  data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage() else { return nil }
        let rep = NSBitmapImageRep(cgImage: scaled)
        var quality: CGFloat = 0.7
        while quality >= 0.15 {
            if let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]),
               // base64 expands bytes 4:3 (rounded up to a 4-char block)
               (data.count + 2) / 3 * 4 <= maxScreenshotB64Characters {
                return data
            }
            quality -= 0.1
        }
        NSLog("IDEalize feedback: screenshot too large to attach even at minimum quality — sending without it")
        return nil
    }

    /// POST one feedback row to Supabase (anonymous, insert-only).
    private static func submit(_ text: String, screenshotJPEG: Data?) {
        guard let url = URL(string: endpoint) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(publishableKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(publishableKey)", forHTTPHeaderField: "Authorization")
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        var payload: [String: Any] = [
            "text": text,
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
            "os_version": ProcessInfo.processInfo.operatingSystemVersionString,
        ]
        if let screenshotJPEG {
            payload["screenshot_b64"] = screenshotJPEG.base64EncodedString()
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        URLSession.shared.dataTask(with: req) { _, response, error in
            if let error {
                NSLog("IDEalize feedback: send failed — \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                NSLog("IDEalize feedback: server returned HTTP \(http.statusCode)")
            }
        }.resume()
    }

    /// Append a timestamped entry to the local backup file; any screenshot is
    /// written as a JPEG next to it and referenced from the entry.
    private static func appendLocal(_ text: String, screenshotJPEG: Data?) {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/IDEalize", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("feedback.md")
        let stamp = ISO8601DateFormatter().string(from: Date())
        var entry = "\n## \(stamp)\n\(text)\n"
        if let screenshotJPEG {
            let imageName = "feedback-\(stamp.replacingOccurrences(of: ":", with: "-")).jpg"
            let imageFile = dir.appendingPathComponent(imageName)
            if (try? screenshotJPEG.write(to: imageFile)) != nil {
                entry += "\n![screenshot](\(imageName))\n"
            }
        }
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(entry.utf8))
            try? handle.close()
        } else {
            try? ("# IDEalize Feedback\n" + entry).write(to: file, atomically: true, encoding: .utf8)
        }
    }
}
