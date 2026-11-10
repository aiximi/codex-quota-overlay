import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

test('macOS tracking preserves its exact verified host during clicks and settings, then clears stale associations', async () => {
  test.skip(process.platform !== 'darwin', 'Compiles the production Swift selection policy.');
  test.setTimeout(60_000);
  const directory = await mkdtemp(resolve(tmpdir(), 'quota-macos-tracker-'));
  try {
    // Substitute only OS observations. Compile the actual selection policy,
    // without its polling loop or any control of the user's Codex/application.
    const source = await readFile(resolve('native/macos/WindowTracker.swift'), 'utf8');
    const fixture = resolve(directory, 'tracker-test.swift');
    const executable = resolve(directory, 'tracker-test');
    await writeFile(
      fixture,
      source.slice(0, source.indexOf('\nsignal(SIGPIPE')) +
        `
func codex(_ launch: Double = 1, hidden: Bool = false, terminated: Bool = false,
           bundle: String = "com.openai.codex") -> ApplicationSnapshot {
    return ApplicationSnapshot(pid: 42, bundleID: bundle,
        launchDate: Date(timeIntervalSince1970: launch), active: true,
        hidden: hidden, terminated: terminated, path: "/Applications/Codex.app")
}
let own = ApplicationSnapshot(pid: 1234, bundleID: "io.github.aiximi.codexquota",
    launchDate: Date(timeIntervalSince1970: 1), active: true)
let other = ApplicationSnapshot(pid: 99, bundleID: "unrelated.app",
    launchDate: Date(timeIntervalSince1970: 1), active: true)
let otherCopy = ApplicationSnapshot(pid: 5678, bundleID: "io.github.aiximi.codexquota",
    launchDate: Date(timeIntervalSince1970: 1), active: true)
func window(_ id: UInt32 = 11, x: Double = 10, onscreen: Bool = true,
            owner: Int32 = 42) -> [String: Any] {
    return [kCGWindowNumber as String: NSNumber(value: id),
            kCGWindowOwnerPID as String: NSNumber(value: owner),
            kCGWindowLayer as String: NSNumber(value: 0),
            kCGWindowIsOnscreen as String: NSNumber(value: onscreen),
            kCGWindowAlpha as String: NSNumber(value: 1),
            kCGWindowBounds as String: CGRect(x: x, y: 20, width: 900, height: 700).dictionaryRepresentation]
}
let selection = HostSelection()
var current: ApplicationSnapshot? = codex()
var windows = [window()]
var results = [String: Frame]()
func observe(_ name: String, _ front: ApplicationSnapshot?) {
    results[name] = selection.frame(front: front, parentPID: 1234, windows: windows) { pid in
        guard let app = current, app.pid == pid else { return nil }
        return ApplicationSnapshot(pid: app.pid, bundleID: app.bundleID,
            launchDate: app.launchDate, active: false, hidden: app.hidden,
            terminated: app.terminated, path: app.path)
    }
}
observe("ownWithoutHost", own)
observe("codexForeground", current)
observe("firstClick", own)
observe("secondClick", own)
observe("settings", own)
windows = [window(x: -1400)]
observe("hostMovedWhileSettingsActive", own)
observe("unrelatedApp", other)
observe("ownCannotReviveAfterOtherApp", own)
observe("codexReturns", current)
current = codex(hidden: true)
observe("hostHidden", own)
current = codex()
observe("ownCannotReviveHiddenHost", own)
observe("codexRestored", current)
current = codex(terminated: true)
observe("hostTerminated", own)
current = codex()
observe("codexAfterTermination", current)
current = codex(2)
observe("pidReusedByRestart", own)
observe("newCodexForeground", current)
current = codex(2, bundle: "com.openai.chat")
observe("pidReusedByDifferentApp", own)
current = codex(2)
observe("codexBeforeWindowClosed", current)
windows = [window(12)]
observe("exactWindowClosedButAnotherExists", own)
observe("codexSelectsNewWindow", current)
windows = [window(12, onscreen: false)]
observe("hostMinimizedOrOffSpace", own)
windows = [window(12)]
observe("ownCannotReviveOffSpaceHost", own)
observe("codexOnScreenAgain", current)
current = nil
observe("hostProcessMissing", own)
current = codex(2)
observe("codexBeforeUnknownForeground", current)
observe("unknownForeground", nil)
observe("ownCannotReviveUnknownForeground", own)
observe("codexBeforeOtherCopy", current)
observe("differentOverlayProcess", otherCopy)
observe("ownCannotReviveAfterOtherCopy", own)
observe("codexBeforeReusedWindow", current)
windows = [window(12, owner: 99)]
observe("windowIDReusedByAnotherProcess", own)
windows = [window()]
current = ApplicationSnapshot(pid: 42, bundleID: "com.openai.codex",
    launchDate: nil, active: true, path: "/Applications/Codex.app")
observe("foregroundWithoutLaunchDate", current)
observe("ownCannotRetainWithoutLaunchDate", own)
current = codex(3)
observe("codexBeforeMissingLaunchDate", current)
current = ApplicationSnapshot(pid: 42, bundleID: "com.openai.codex",
    launchDate: nil, active: true, path: "/Applications/Codex.app")
observe("ownCannotRetainIfLaunchDateDisappears", own)
let output = try JSONEncoder().encode(results)
print(String(decoding: output, as: UTF8.self))
`,
    );
    await promisify(execFile)(
      'xcrun',
      ['swiftc', '-swift-version', '5', fixture, '-o', executable],
      { timeout: 30_000 },
    );
    const { stdout } = await promisify(execFile)(executable, [], { timeout: 10_000 });
    const results = JSON.parse(stdout) as Record<
      string,
      {
        visible: boolean;
        bounds?: { x: number; y: number; width: number; height: number };
      }
    >;
    const visible = [
      'codexForeground',
      'firstClick',
      'secondClick',
      'settings',
      'hostMovedWhileSettingsActive',
      'codexReturns',
      'codexRestored',
      'codexAfterTermination',
      'newCodexForeground',
      'codexBeforeWindowClosed',
      'codexSelectsNewWindow',
      'codexOnScreenAgain',
      'codexBeforeUnknownForeground',
      'codexBeforeOtherCopy',
      'codexBeforeReusedWindow',
      'foregroundWithoutLaunchDate',
      'codexBeforeMissingLaunchDate',
    ];
    for (const [name, frame] of Object.entries(results))
      expect(frame.visible, name).toBe(visible.includes(name));
    expect(Object.keys(results)).toHaveLength(36);
    expect(results.hostMovedWhileSettingsActive.bounds).toEqual({
      x: -1400,
      y: 20,
      width: 900,
      height: 700,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
