import Foundation
import FluidAudio

/// One utterance in a transcript: a time-stamped run of speech, optionally
/// attributed to a speaker. Timestamps are seconds from the start of the
/// recording.
struct TranscriptSegment: Identifiable, Sendable {
    let id = UUID()
    var start: TimeInterval
    var end: TimeInterval
    var speaker: String?
    var text: String
}

/// Metadata stamped into the `## Transcript` block that drops into the document.
struct TranscriptMeta: Sendable {
    var date: Date
    var duration: TimeInterval
    var provider: String
}

/// The adapter boundary (spec §10): the product talks to *a* transcription
/// engine, never a specific one. Today the only implementation is FluidAudio
/// (local, on-device); a Whisper-compatible or remote engine can drop in behind
/// the same protocol.
protocol TranscriptionProvider: Sendable {
    /// Shown in the transcript metadata line, e.g. "on-device · FluidAudio".
    var displayName: String { get }
    /// Whether the models are already loaded (drives the "preparing model" hint
    /// on first run, when a download is needed).
    var isReady: Bool { get }
    /// Load models if needed. May download on first use.
    func prepare() async throws
    /// Transcribe a recorded audio file into ordered segments.
    func transcribe(fileURL: URL) async throws -> [TranscriptSegment]
}

/// Local speech-to-text via FluidAudio (NVIDIA Parakeet TDT on CoreML / the
/// Apple Neural Engine). Models download once on first use, then run fully
/// on-device — no audio or text ever leaves the Mac.
///
/// `@unchecked Sendable`: the underlying `AsrManager` isn't `Sendable`, but the
/// recording manager only ever transcribes one recording at a time, so calls
/// are never concurrent.
final class FluidAudioProvider: TranscriptionProvider, @unchecked Sendable {
    let displayName = "on-device · FluidAudio (Parakeet v3)"

    private(set) var isReady = false
    private var asr: AsrManager?

    func prepare() async throws {
        if asr != nil { return }
        let models = try await AsrModels.downloadAndLoad()
        let manager = AsrManager()
        try await manager.loadModels(models)
        asr = manager
        isReady = true
    }

    func transcribe(fileURL: URL) async throws -> [TranscriptSegment] {
        try await prepare()
        guard let asr else { throw ASRError.notInitialized }
        // A fresh decoder state per file. The URL overload auto-switches to a
        // disk-backed, constant-memory path for long recordings.
        var decoderState = try TdtDecoderState()
        let result = try await asr.transcribe(fileURL, decoderState: &decoderState)
        // Prefer word timings for `[mm:ss]` grouping; fall back to the flat text.
        let words = buildWordTimings(from: result.tokenTimings ?? [])
        return TranscriptFormatter.segments(from: words, fallbackText: result.text)
    }
}

/// Turns raw word/segment timings into readable, time-stamped Markdown. Kept
/// separate from the provider so a different engine reuses the same formatting.
enum TranscriptFormatter {
    /// Group words into utterances, breaking on a long pause or once a line has
    /// grown past `maxChars` and reaches a sentence end.
    static func segments(from words: [WordTiming],
                         fallbackText: String,
                         pauseGap: TimeInterval = 1.5,
                         maxChars: Int = 240) -> [TranscriptSegment] {
        guard !words.isEmpty else {
            let trimmed = fallbackText.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? [] : [TranscriptSegment(start: 0, end: 0, text: trimmed)]
        }

        var segments: [TranscriptSegment] = []
        var current: [String] = []
        var segStart = words[0].startTime
        var prevEnd = words[0].startTime

        func flush(end: TimeInterval) {
            let text = current.joined(separator: " ").trimmingCharacters(in: .whitespaces)
            if !text.isEmpty {
                segments.append(TranscriptSegment(start: segStart, end: end, text: text))
            }
            current.removeAll(keepingCapacity: true)
        }

        for word in words {
            if !current.isEmpty {
                let bigPause = word.startTime - prevEnd > pauseGap
                let longAndSentenceEnd = current.joined(separator: " ").count > maxChars
                    && (current.last.map { $0.hasSuffix(".") || $0.hasSuffix("?") || $0.hasSuffix("!") } ?? false)
                if bigPause || longAndSentenceEnd {
                    flush(end: prevEnd)
                    segStart = word.startTime
                }
            }
            current.append(word.word)
            prevEnd = word.endTime
        }
        flush(end: prevEnd)
        return segments
    }

    /// `mm:ss`, or `h:mm:ss` past an hour.
    static func timestamp(_ t: TimeInterval) -> String {
        let total = max(0, Int(t.rounded(.down)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s)
                     : String(format: "%02d:%02d", m, s)
    }

    static func durationString(_ t: TimeInterval) -> String {
        let total = max(0, Int(t.rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if h > 0 { return String(format: "%dh %02dm", h, m) }
        if m > 0 { return String(format: "%dm %02ds", m, s) }
        return "\(s)s"
    }

    /// The `## Transcript` block appended to the document when recording stops.
    static func markdown(segments: [TranscriptSegment], meta: TranscriptMeta) -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm"
        var lines = ["", "## Transcript", "",
                     "_\(df.string(from: meta.date)) · \(durationString(meta.duration)) · \(meta.provider)_", ""]
        if segments.isEmpty {
            lines.append("_(No speech detected.)_")
        } else {
            for seg in segments {
                let ts = timestamp(seg.start)
                if let speaker = seg.speaker, !speaker.isEmpty {
                    lines.append("[\(ts)] \(speaker): \(seg.text)")
                } else {
                    lines.append("[\(ts)] \(seg.text)")
                }
            }
        }
        lines.append("")
        return lines.joined(separator: "\n")
    }
}
