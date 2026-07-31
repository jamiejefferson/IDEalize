import SwiftUI
import AppKit

struct ScrollableMarkdownEditor: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool = true
    var isSelectable: Bool = true
    var font: NSFont?
    var textColor: NSColor?
    var backgroundColor: NSColor?
    var lineSpacing: CGFloat = 0
    var scrollToLineNumber: Int?
    var onScroll: (Int) -> Void = { _ in }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.string = text
        textView.isEditable = isEditable
        textView.isSelectable = isSelectable
        textView.usesFindBar = true

        if let font {
            textView.font = font
        }
        if let textColor {
            textView.textColor = textColor
        }
        if let backgroundColor {
            textView.backgroundColor = backgroundColor
        }

        if lineSpacing > 0 {
            let style = NSMutableParagraphStyle()
            style.lineSpacing = lineSpacing
            let attributes: [NSAttributedString.Key: Any] = [
                .paragraphStyle: style
            ]
            let attributedString = NSAttributedString(string: text, attributes: attributes)
            textView.textStorage?.setAttributedString(attributedString)
        }

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true

        return scrollView
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let textView = nsView.documentView as? NSTextView else { return }

        if textView.string != text {
            textView.string = text
        }

        if let lineNumber = scrollToLineNumber {
            scrollToLine(lineNumber, in: textView, scrollView: nsView)
        }
    }

    private func scrollToLine(_ lineNumber: Int, in textView: NSTextView, scrollView: NSScrollView) {
        let lines = textView.string.components(separatedBy: "\n")
        guard lineNumber < lines.count else { return }

        var charOffset = 0
        for i in 0..<lineNumber {
            charOffset += lines[i].count + 1
        }

        guard charOffset <= textView.string.count else { return }

        let range = NSRange(location: charOffset, length: 0)
        textView.setSelectedRange(range)
        textView.scrollRangeToVisible(range)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String

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
