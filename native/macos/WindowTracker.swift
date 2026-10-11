import AppKit
import CoreGraphics
import Foundation

// This helper observes only process identity and public window geometry. It
// neither captures pixels nor reads window titles or accessibility contents.
struct Bounds: Encodable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Frame: Encodable, Equatable {
    let visible: Bool
    var bounds: Bounds? = nil
    var appPath: String? = nil
}

final class WindowObserver {
    private var lastFrame: Frame?
    private var lastEmission = Date.distantPast
    private let originalParent = getppid()

    func poll() {
        // Do not leave an orphan helper running after the Electron host exits.
        guard getppid() == originalParent, originalParent > 1 else { exit(0) }
        let frame = currentFrame()
        let now = Date()
        guard frame != lastFrame || now.timeIntervalSince(lastEmission) >= 1 else { return }
        guard var data = try? JSONEncoder().encode(frame) else { return }
        data.append(0x0a)
        do { try FileHandle.standardOutput.write(contentsOf: data) }
        catch { exit(0) }
        lastFrame = frame
        lastEmission = now
    }

    private func currentFrame() -> Frame {
        guard let app = NSWorkspace.shared.frontmostApplication,
              // com.openai.chat is the separate ChatGPT app, not Codex.
              app.bundleIdentifier == "com.openai.codex",
              app.isActive, !app.isHidden, !app.isTerminated,
              let windows = CGWindowListCopyWindowInfo(
                [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
              ) as? [[String: Any]] else { return Frame(visible: false) }

        for window in windows {
            guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier,
                  (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
                  ((window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.01,
                  let values = window[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: values as CFDictionary),
                  rect.width >= 460, rect.height >= 300,
                  rect.origin.x.isFinite, rect.origin.y.isFinite,
                  rect.width.isFinite, rect.height.isFinite else { continue }

            // Quartz already uses the top-left coordinate system Electron
            // expects on macOS. Do not apply AppKit's bottom-left conversion.
            return Frame(
                visible: true,
                bounds: Bounds(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height),
                appPath: app.bundleURL?.path
            )
        }
        return Frame(visible: false)
    }
}

signal(SIGPIPE, SIG_IGN)
let observer = WindowObserver()
let timer = Timer(timeInterval: 0.25, repeats: true) { _ in observer.poll() }
RunLoop.main.add(timer, forMode: .common)
observer.poll()
RunLoop.main.run()
