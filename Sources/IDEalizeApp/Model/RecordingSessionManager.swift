import Foundation
import AVFoundation

/// Captures microphone audio to a file on disk. We record at the input's native
/// format (no lossy conversion) into a `.caf`; the transcription provider does
/// its own 16 kHz-mono conversion when it reads the file back.
final class AudioRecorder {
    enum RecorderError: LocalizedError {
        case noInput
        var errorDescription: String? { "No microphone input is available." }
    }

    private let engine = AVAudioEngine()
    private var file: AVAudioFile?

    /// Begin writing microphone audio to `url`. Throws if there's no usable input.
    func start(to url: URL) throws {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else { throw RecorderError.noInput }

        let audioFile = try AVAudioFile(forWriting: url, settings: format.settings)
        file = audioFile

        input.removeTap(onBus: 0)
        // The tap fires on a realtime audio thread; writing straight to the file
        // is the one supported side effect here. `file` is only ever niled after
        // the tap is removed (in `stop`), so the optional-chained write is safe.
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            try? self?.file?.write(from: buffer)
        }
        engine.prepare()
        try engine.start()
    }

    /// Stop capture and flush/close the file.
    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        file = nil   // deinit closes and finalises the file
    }
}

/// Owns the record → transcribe → drop-in lifecycle for meeting capture in the
/// document panel. A singleton so the in-flight recording survives the document
/// view being rebuilt (e.g. when the user switches files mid-recording).
///
/// Interaction model (per the product decision): the user keeps typing notes in
/// the open document while a recording indicator shows in the text area; the
/// transcript is captured to audio and only *drops into the document when they
/// stop*. Nothing writes to the editor during recording, so the cursor is never
/// hijacked and typed notes can't be overwritten.
@MainActor
final class RecordingSessionManager: ObservableObject {
    static let shared = RecordingSessionManager()

    enum State: Equatable {
        case idle
        case recording
        case transcribing       // running the model over the finished audio
        case error(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    /// A finished transcript waiting to be dropped into its document. The panel
    /// observes this, appends it to the target doc, then clears it.
    @Published var pendingTranscript: String?
    /// Extra line shown under a busy state, e.g. the first-run model download.
    @Published private(set) var detail: String?

    /// The document this recording appends its transcript to (captured at start).
    private(set) var targetURL: URL?

    private let recorder = AudioRecorder()
    private let provider: TranscriptionProvider = FluidAudioProvider()
    private var timer: Timer?
    private var startDate: Date?
    private var audioURL: URL?

    var isRecording: Bool { state == .recording }
    var isBusy: Bool { state != .idle }

    /// True when this manager is busy with `url` specifically (drives per-document
    /// toolbar/indicator state — another document shouldn't show this one's timer).
    func isActive(for url: URL?) -> Bool {
        guard let url, let targetURL else { return false }
        return url.standardizedFileURL == targetURL.standardizedFileURL
    }

    // MARK: - Lifecycle

    /// Toggle recording for `documentURL`: start if idle, stop if this document
    /// is the one recording.
    func toggle(documentURL: URL) {
        if isRecording, isActive(for: documentURL) { stop() }
        else if !isBusy { start(documentURL: documentURL) }
    }

    func start(documentURL: URL) {
        guard state == .idle else { return }
        detail = nil
        requestMicrophone { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.state = .error("Microphone access denied. Grant it in System Settings → Privacy & Security → Microphone.")
                return
            }
            do {
                let url = Self.recordingsDir().appendingPathComponent("\(UUID().uuidString).caf")
                try self.recorder.start(to: url)
                self.audioURL = url
                self.targetURL = documentURL
                self.startDate = Date()
                self.elapsed = 0
                self.state = .recording
                self.startTimer()
            } catch {
                self.state = .error("Couldn't start recording: \(error.localizedDescription)")
            }
        }
    }

    func stop() {
        guard isRecording else { return }
        stopTimer()
        recorder.stop()
        guard let audioURL, let started = startDate else { state = .idle; return }
        let duration = Date().timeIntervalSince(started)
        detail = provider.isReady ? nil : "Preparing transcription model (first run — this can take a minute)…"
        state = .transcribing

        let provider = self.provider
        Task { [weak self] in
            do {
                let segments = try await provider.transcribe(fileURL: audioURL)
                let meta = TranscriptMeta(date: started, duration: duration, provider: provider.displayName)
                let markdown = TranscriptFormatter.markdown(segments: segments, meta: meta)
                await MainActor.run {
                    guard let self else { return }
                    self.pendingTranscript = markdown
                    self.detail = nil
                    self.state = .idle
                    // Raw audio isn't retained by default once transcribed (spec §13).
                    self.deleteAudio()
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.detail = nil
                    // Keep the audio on failure so the meeting isn't lost (spec §12).
                    self.state = .error("Transcription failed: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Dismiss an error indicator back to idle.
    func clearError() {
        if case .error = state { state = .idle; detail = nil }
    }

    // MARK: - Timer

    private func startTimer() {
        timer?.invalidate()
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let started = self.startDate, self.isRecording else { return }
                self.elapsed = Date().timeIntervalSince(started)
            }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Permission & storage

    private func requestMicrophone(_ completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        default:
            completion(false)
        }
    }

    private func deleteAudio() {
        if let audioURL { try? FileManager.default.removeItem(at: audioURL) }
        audioURL = nil
    }

    /// `~/Library/Application Support/IDEalize/recordings`, created on demand.
    static func recordingsDir() -> URL {
        let base = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/IDEalize/recordings")
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }
}
