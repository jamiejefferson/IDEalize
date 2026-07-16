import Foundation
import AVFoundation
import AppKit

/// The "task complete" chime — a digital shine played when Claude signals it has
/// finished (via `idealize notify --sound`). Loaded from the app bundle, or the
/// dev `Resources/` dir, following the same bundle-then-dev pattern as `Branding`.
enum DoneSound {
    // Held strong so the player isn't deallocated mid-playback.
    private static var player: AVAudioPlayer?

    private static let url: URL? = {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("TaskComplete.mp3"),
           FileManager.default.fileExists(atPath: bundled.path) {
            return bundled
        }
        let dev = FileManager.default.currentDirectoryPath + "/Resources/TaskComplete.mp3"
        return FileManager.default.fileExists(atPath: dev) ? URL(fileURLWithPath: dev) : nil
    }()

    /// Play the completion chime, if enabled in settings. Safe to call from any
    /// thread; hops to main.
    static func play() {
        guard AppSettings.shared.completionSoundEnabled else { return }
        preview()
    }

    /// Play the chime regardless of the enabled toggle — used by the settings
    /// audition button. Uses the current volume setting.
    static func preview() {
        let volume = Float(AppSettings.shared.completionSoundVolume)
        DispatchQueue.main.async {
            guard let url else {
                NSSound.beep()   // fall back to a system beep if the asset is missing
                return
            }
            do {
                let p = try AVAudioPlayer(contentsOf: url)
                p.volume = volume
                p.prepareToPlay()
                p.play()
                player = p
            } catch {
                NSSound.beep()
            }
        }
    }
}
