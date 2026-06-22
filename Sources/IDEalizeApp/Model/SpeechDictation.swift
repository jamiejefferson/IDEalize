import Foundation
import Speech
import AVFoundation

/// On-device speech-to-text for the chat input (press-and-hold to speak).
/// Uses `SFSpeechRecognizer` + `AVAudioEngine`; no network/native-AI.
@MainActor
final class SpeechDictation: ObservableObject {
    static let shared = SpeechDictation()

    @Published var isRecording = false
    @Published var available = false
    /// Last failure reason (shown briefly in the chat input mini-menu).
    @Published var lastError: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()

    /// Called with the live transcript as the user speaks.
    var onUpdate: ((String) -> Void)?

    func requestAuthorization() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                self?.available = (status == .authorized) && (self?.recognizer?.isAvailable ?? false)
            }
        }
        // Speech auth is separate from microphone access — request both up front.
        AVCaptureDevice.requestAccess(for: .audio) { _ in }
    }

    func start() {
        guard !isRecording else { return }
        lastError = nil
        // Speech recognition authorization.
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        if speechStatus == .notDetermined {
            SFSpeechRecognizer.requestAuthorization { [weak self] _ in
                DispatchQueue.main.async { self?.start() }
            }
            return
        }
        guard speechStatus == .authorized else { lastError = "Speech recognition not allowed"; return }
        guard let recognizer, recognizer.isAvailable else { lastError = "Recognizer unavailable"; return }

        // Microphone authorization.
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async { if granted { self?.start() } else { self?.lastError = "Microphone denied" } }
            }
            return
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            lastError = "Microphone not allowed"; return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // Use server recognition by default (more reliable than an undownloaded
        // on-device model). Only force on-device if there's no network path.
        req.requiresOnDeviceRecognition = false
        request = req

        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else {
            lastError = "No microphone input"; request = nil; return
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch {
            lastError = "Audio engine: \(error.localizedDescription)"; cleanup(); return
        }
        isRecording = true

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result { self.onUpdate?(result.bestTranscription.formattedString) }
            if let error, self.isRecording {
                NSLog("IDEalize dictation error: \(error.localizedDescription)")
            }
        }
    }

    func stop() {
        guard isRecording else { return }
        request?.endAudio()
        cleanup()
    }

    private func cleanup() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel()
        task = nil
        request = nil
        isRecording = false
    }
}
