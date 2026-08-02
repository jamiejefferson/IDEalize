import SwiftUI
import AppKit

/// Where the outline wants the editor scrolled to. `token` makes each request
/// distinct so selecting the *same* heading twice still scrolls — a bare line
/// number would compare equal to the last one and be skipped.
struct MarkdownScrollTarget: Equatable {
    let line: Int
    let token: Int
}

/// The document panel's text editor. An `NSTextView` rather than SwiftUI's
/// `TextEditor` because jumping to a heading needs the layout manager: only it
/// can say where a given line actually sits, which is what lets the outline
/// scroll that line to the top of the viewport.
struct ScrollableMarkdownEditor: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool = true
    var isSelectable: Bool = true
    var font: NSFont?
    var textColor: NSColor?
    var backgroundColor: NSColor?
    var lineSpacing: CGFloat = 0
    var scrollTarget: MarkdownScrollTarget?
    /// Identifies the open document. When it changes the view starts at the top
    /// instead of inheriting the previous file's scroll offset — the text view
    /// is reused across documents, so nothing else would reset it.
    var documentID: String?

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.usesFindBar = true
        // Plain-text editing: typed and pasted text takes the document font
        // instead of carrying styling in from the clipboard.
        textView.isRichText = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false

        // Canonical NSTextView-in-NSScrollView geometry: track the clip view's
        // width so text wraps and the view grows vertically. Without this the
        // layout manager's line rects — the basis of jump-to-heading — are
        // measured against a container of the wrong size.
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)

        scrollView.documentView = textView
        applyStyle(to: textView)
        textView.string = text
        return scrollView
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let textView = nsView.documentView as? NSTextView else { return }
        applyStyle(to: textView)

        if textView.string != text {
            textView.string = text
        }

        // A different document: reset to the top. Keyed on the document rather
        // than "the text changed" so appending a transcript to the open file
        // doesn't yank the reader back up.
        if documentID != context.coordinator.lastDocumentID {
            context.coordinator.lastDocumentID = documentID
            textView.setSelectedRange(NSRange(location: 0, length: 0))
            nsView.contentView.scroll(to: .zero)
            nsView.reflectScrolledClipView(nsView.contentView)
        }

        // Only act on a target we haven't served yet, so an unrelated SwiftUI
        // re-render can't yank the reader back to the last heading they picked.
        if let target = scrollTarget, target != context.coordinator.lastTarget {
            context.coordinator.lastTarget = target
            scroll(textView, in: nsView, toLine: target.line)
        }
    }

    /// Font, colours and line spacing — reapplied on every update so a theme or
    /// font-size change lands, and so replacing `string` can't strip them.
    private func applyStyle(to textView: NSTextView) {
        if let font, textView.font != font { textView.font = font }
        if let textColor, textView.textColor != textColor { textView.textColor = textColor }
        if let backgroundColor {
            textView.backgroundColor = backgroundColor
            textView.drawsBackground = true
        }
        if textView.isEditable != isEditable { textView.isEditable = isEditable }
        if textView.isSelectable != isSelectable { textView.isSelectable = isSelectable }

        // Line spacing rides on the default paragraph style (and the typing
        // attributes) rather than a one-off attributed string, so it survives
        // every later edit and reload.
        let style = NSMutableParagraphStyle()
        style.lineSpacing = lineSpacing
        textView.defaultParagraphStyle = style
        var typing = textView.typingAttributes
        typing[.paragraphStyle] = style
        if let font { typing[.font] = font }
        if let textColor { typing[.foregroundColor] = textColor }
        textView.typingAttributes = typing

        // Existing text predates the style above, so restyle it in place.
        if let storage = textView.textStorage, storage.length > 0 {
            let all = NSRange(location: 0, length: storage.length)
            storage.beginEditing()
            storage.addAttribute(.paragraphStyle, value: style, range: all)
            if let font { storage.addAttribute(.font, value: font, range: all) }
            if let textColor { storage.addAttribute(.foregroundColor, value: textColor, range: all) }
            storage.endEditing()
        }
    }

    /// Scroll so `lineNumber` sits at the *top* of the viewport, the way an IDE's
    /// jump-to-symbol does — `scrollRangeToVisible` alone does the minimum scroll,
    /// which leaves the heading pinned to the bottom edge with its section
    /// off-screen below.
    private func scroll(_ textView: NSTextView, in scrollView: NSScrollView, toLine lineNumber: Int) {
        guard let offset = utf16Offset(ofLine: lineNumber, in: textView.string) else { return }
        let range = NSRange(location: offset, length: 0)

        textView.setSelectedRange(range)

        guard let layoutManager = textView.layoutManager,
              let container = textView.textContainer else {
            textView.scrollRangeToVisible(range)
            return
        }
        // The rect is only meaningful once the text is laid out that far.
        layoutManager.ensureLayout(for: container)
        let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        let lineRect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: container)

        let clipView = scrollView.contentView
        let targetY = lineRect.minY + textView.textContainerInset.height
        // Clamp: the last screenful of a document can't be scrolled past.
        let maxY = max(0, textView.frame.height - clipView.bounds.height)
        clipView.scroll(to: NSPoint(x: 0, y: min(max(0, targetY), maxY)))
        scrollView.reflectScrolledClipView(clipView)
    }

    /// UTF-16 offset of the start of `lineNumber`, counting lines the same way
    /// `MarkdownOutline.parse` does (split on "\n").
    ///
    /// `NSRange` indexes UTF-16 units, *not* Swift `Character`s: counting
    /// characters puts every jump past an emoji or other non-BMP glyph short by
    /// one unit per glyph, landing the reader mid-paragraph above the heading.
    private func utf16Offset(ofLine lineNumber: Int, in text: String) -> Int? {
        guard lineNumber > 0 else { return 0 }
        let ns = text as NSString
        var offset = 0
        var line = 0
        while line < lineNumber {
            let remaining = NSRange(location: offset, length: ns.length - offset)
            let newline = ns.range(of: "\n", options: [], range: remaining)
            guard newline.location != NSNotFound else { return nil }
            offset = NSMaxRange(newline)
            line += 1
        }
        return offset
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String
        /// The last jump actually performed — see `MarkdownScrollTarget.token`.
        var lastTarget: MarkdownScrollTarget?
        /// The document the text view is currently showing.
        var lastDocumentID: String?

        init(text: Binding<String>) {
            self._text = text
        }

        func textDidChange(_ notification: Notification) {
            if let textView = notification.object as? NSTextView {
                text = textView.string
            }
        }
    }
}
