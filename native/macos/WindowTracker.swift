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
    var overlayVisible: Bool? = nil
}

func isOverlayOnScreen(_ windows: [[String: Any]], windowID: CGWindowID, ownerPID: pid_t) -> Bool {
    return windows.contains { window in
        (window[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID &&
        (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == ownerPID &&
        (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true &&
        ((window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.01
    }
}

struct ApplicationSnapshot {
    let pid: pid_t
    let bundleID: String?
    let launchDate: Date?
    let active: Bool
    let hidden: Bool
    let terminated: Bool
    let path: String?

    init(pid: pid_t, bundleID: String?, launchDate: Date?, active: Bool,
         hidden: Bool = false, terminated: Bool = false, path: String? = nil) {
        self.pid = pid
        self.bundleID = bundleID
        self.launchDate = launchDate
        self.active = active
        self.hidden = hidden
        self.terminated = terminated
        self.path = path
    }

    init(_ application: NSRunningApplication) {
        self.init(pid: application.processIdentifier, bundleID: application.bundleIdentifier,
                  launchDate: application.launchDate, active: application.isActive,
                  hidden: application.isHidden, terminated: application.isTerminated,
                  path: application.bundleURL?.path)
    }
}

// Keep a verified host while the user interacts with our own panel or Settings.
// Only foreground Codex can establish a host; our application cannot revive one
// after another application, a hidden/closed window, or a process restart.
final class HostSelection {
    private struct Host {
        let pid: pid_t
        let launchDate: Date?
        let windowID: CGWindowID
    }
    private var host: Host?

    func frame(front: ApplicationSnapshot?, parentPID: pid_t,
               windows: [[String: Any]], application: (pid_t) -> ApplicationSnapshot?) -> Frame {
        guard let front = front, front.active, !front.hidden, !front.terminated else {
            return clear()
        }

        let candidate: ApplicationSnapshot
        let requiredWindow: CGWindowID?
        if front.bundleID == "com.openai.codex" {
            candidate = front
            requiredWindow = nil
        } else if front.pid == parentPID, let host = host, let launchDate = host.launchDate,
                  let previous = application(host.pid), previous.pid == host.pid,
                  previous.bundleID == "com.openai.codex",
                  previous.launchDate == launchDate,
                  !previous.hidden, !previous.terminated {
            candidate = previous
            requiredWindow = host.windowID
        } else {
            return clear()
        }

        for window in windows {
            guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == candidate.pid,
                  let windowID = (window[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  windowID != 0, requiredWindow == nil || windowID == requiredWindow,
                  (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
                  ((window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.01,
                  let values = window[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: values as CFDictionary),
                  rect.width >= 460, rect.height >= 300,
                  rect.origin.x.isFinite, rect.origin.y.isFinite,
                  rect.width.isFinite, rect.height.isFinite else { continue }

            host = Host(pid: candidate.pid, launchDate: candidate.launchDate, windowID: windowID)
            // Quartz already uses Electron's top-left coordinate system.
            return Frame(visible: true,
                         bounds: Bounds(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height),
                         appPath: candidate.path)
        }
        return clear()
    }

    private func clear() -> Frame {
        host = nil
        return Frame(visible: false)
    }
}

final class WindowObserver {
    private var lastFrame: Frame?
    private var lastEmission = Date.distantPast
    private let originalParent = getppid()
    private let overlayID = CommandLine.arguments.dropFirst().first.flatMap(UInt32.init)
    private let selection = HostSelection()

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
        let front = NSWorkspace.shared.frontmostApplication.map(ApplicationSnapshot.init)
        let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] ?? []
        var frame = selection.frame(front: front, parentPID: originalParent, windows: windows) { pid in
            NSRunningApplication(processIdentifier: pid).map(ApplicationSnapshot.init)
        }
        if frame.visible {
            frame.overlayVisible = overlayID.map {
                isOverlayOnScreen(windows, windowID: $0, ownerPID: originalParent)
            }
        }
        return frame
    }
}

signal(SIGPIPE, SIG_IGN)
let observer = WindowObserver()
let timer = Timer(timeInterval: 0.25, repeats: true) { _ in observer.poll() }
RunLoop.main.add(timer, forMode: .common)
observer.poll()
RunLoop.main.run()
