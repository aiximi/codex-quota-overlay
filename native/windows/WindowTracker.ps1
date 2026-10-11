param([int]$ParentProcessId = 0)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# One long-running helper avoids repeatedly starting PowerShell. Only process
# identity and window bounds are inspected; no titles, pixels or UI text.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CodexWindowGeometry {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr window);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr window, int attribute,
        out Rect bounds, int size);
}
'@

function Get-WindowProcessId {
    param([IntPtr]$Window)

    [uint32]$windowProcessId = 0
    [void][CodexWindowGeometry]::GetWindowThreadProcessId($Window, [ref]$windowProcessId)
    return $windowProcessId
}

function Get-CodexWindowFrame {
    param([IntPtr]$Window)

    if ($Window -eq [IntPtr]::Zero -or
        -not [CodexWindowGeometry]::IsWindowVisible($Window) -or
        [CodexWindowGeometry]::IsIconic($Window)) { return @{ visible = $false } }

    $windowProcessId = Get-WindowProcessId -Window $Window
    $targetProcess = Get-Process -Id $windowProcessId -ErrorAction Stop
    $executable = $targetProcess.MainModule.FileName
    $fileName = [System.IO.Path]::GetFileName($executable)
    if ($fileName -notin @('Codex.exe', 'ChatGPT.exe')) { return @{ visible = $false } }

    $metadata = $targetProcess.MainModule.FileVersionInfo
    $isCodexProduct = $metadata.ProductName -eq 'Codex' -or $metadata.FileDescription -eq 'Codex'
    $isOpenAICodex = $fileName -eq 'Codex.exe' -and $metadata.CompanyName -match '^OpenAI(?:\b|$)'
    if (-not ($isCodexProduct -or $isOpenAICodex)) { return @{ visible = $false } }

    $bounds = [CodexWindowGeometry+Rect]::new()
    # DWMWA_EXTENDED_FRAME_BOUNDS (9) is in physical pixels and excludes the
    # invisible resizing border. The Electron host converts this to DIP.
    $result = [CodexWindowGeometry]::DwmGetWindowAttribute(
        $Window, 9, [ref]$bounds, [System.Runtime.InteropServices.Marshal]::SizeOf($bounds))
    if ($result -ne 0) { return @{ visible = $false } }
    $width = $bounds.Right - $bounds.Left
    $height = $bounds.Bottom - $bounds.Top
    if ($width -lt 460 -or $height -lt 300) { return @{ visible = $false } }

    return @{
        visible = $true
        bounds = @{ x = $bounds.Left; y = $bounds.Top; width = $width; height = $height }
        appPath = $executable
    }
}

$script:TrackedWindow = [IntPtr]::Zero

function Get-CodexFrame {
    param([IntPtr]$ForegroundWindow = [CodexWindowGeometry]::GetForegroundWindow())

    $window = $ForegroundWindow
    $windowProcessId = Get-WindowProcessId -Window $window
    # Clicking a focusable Windows overlay transfers foreground ownership from
    # Codex to our Electron main process. Keep the last verified Codex HWND while
    # our own UI is active, or the next poll would hide it during the click.
    # An unrelated foreground app always breaks this association.
    if ($ParentProcessId -gt 0 -and $windowProcessId -eq $ParentProcessId) {
        $window = $script:TrackedWindow
    }

    try {
        # Revalidate every poll: a remembered HWND can be closed, minimized, or
        # reused, and the host may move while the overlay has keyboard focus.
        $frame = Get-CodexWindowFrame -Window $window
    }
    catch { $frame = @{ visible = $false } }

    if ($frame.visible) { $script:TrackedWindow = $window }
    else { $script:TrackedWindow = [IntPtr]::Zero }
    return $frame
}

# Allow the selection policy to be loaded without launching the polling loop.
if ($MyInvocation.InvocationName -eq '.') { return }

$lastJson = ''
$lastEmission = [DateTime]::MinValue
while ($true) {
    if ($ParentProcessId -gt 0 -and -not (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue)) { exit 0 }
    try { $frame = Get-CodexFrame }
    catch { $frame = @{ visible = $false } }
    $json = ConvertTo-Json -InputObject $frame -Compress -Depth 3
    $now = [DateTime]::UtcNow
    if ($json -ne $lastJson -or ($now - $lastEmission).TotalSeconds -ge 1) {
        try { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
        catch { exit 0 }
        $lastJson = $json
        $lastEmission = $now
    }
    Start-Sleep -Milliseconds 250
}
