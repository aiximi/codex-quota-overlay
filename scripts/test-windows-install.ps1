#Requires -Version 7.0
<#
Tests this project's real NSIS installer on a disposable Windows CI runner.
Uses D: when available, an installation path containing spaces, and offline app data.
No signing, SmartScreen, Defender, execution-policy, or account settings are changed.
#>
[CmdletBinding()]
param(
    [Alias('Installer')]
    [string]$InstallerPath,
    [string]$InstallBase,
    [string]$OutputDirectory,
    [switch]$SkipWizardUi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run this test only on a disposable GitHub-hosted Windows Actions runner.'
}

$repo = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$product = 'Codex Quota Overlay'
# electron-builder UUID v5 for io.github.aiximi.codexquota, used by this app's NSIS installer.
$registrationId = '6347e0dd-6625-5735-b75c-d8fe8d5a14fe'
if ($package.productName -ne $product -or $package.build.appId -ne 'io.github.aiximi.codexquota' -or
    $package.build.nsis.oneClick -ne $false -or
    $package.build.nsis.allowToChangeInstallationDirectory -ne $true -or
    $package.build.nsis.perMachine -eq $true) {
    throw 'Expected this project to use an assisted installer with an editable directory and current-user installation.'
}
if (-not $InstallerPath) {
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $repo 'release') -Filter '*-windows-x64-setup.exe' -File)
    if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 setup executable in release/. Specify -Installer to select one explicitly.' }
    $InstallerPath = $installers[0].FullName
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repo 'test-results/windows-installation'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($OutputDirectory)
if (-not $InstallBase) {
    $InstallBase = if (Test-Path -LiteralPath 'D:\') { 'D:\Codex Quota CI' }
        else { Join-Path ([IO.Path]::GetTempPath()) 'Codex Quota CI' }
}
if (-not [IO.Path]::IsPathFullyQualified($InstallBase)) {
    throw 'InstallBase must be an absolute path on a writable drive.'
}
$runRoot = Join-Path $InstallBase ([Guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $runRoot $product
$appExecutable = Join-Path $installDirectory "$product.exe"
$uninstaller = Join-Path $installDirectory "Uninstall $product.exe"
$ownedProcesses = [Collections.Generic.List[object]]::new()
$createdTestDirectory = $false
$signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
$result = [ordered]@{
    installer = [IO.Path]::GetFileName($InstallerPath)
    signatureStatus = $signature.Status.ToString()
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    installDirectory = $installDirectory
    directoryPageVerified = $false
    directoryScreenshot = $null
    installationVerified = $false
    offlineLaunchVerified = $false
    uninstallVerified = $false
    fullVerification = $false
    passed = $false
}

function Get-ProductRegistration {
    # Refuse to touch a runner with an existing installation of this application.
    foreach ($root in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root) {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath
            if ($key.PSChildName -eq $registrationId -or
                ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -eq $product)) {
                $entry
            }
        }
    }
}

function Get-InstallationStateKey {
    foreach ($root in @('HKCU:\Software', 'HKCU:\Software\WOW6432Node', 'HKLM:\Software', 'HKLM:\Software\WOW6432Node')) {
        $key = Join-Path $root $registrationId
        if (Test-Path -LiteralPath $key) { $key }
    }
}

function Start-OwnedProcess([string]$File, [string]$Arguments, [string]$Name, [hashtable]$Environment = @{}) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    # NSIS /D= and _?= must be last and unquoted, even when the path contains spaces.
    $info.Arguments = $Arguments
    $info.WorkingDirectory = $runRoot
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    [void]$info.Environment.Remove('ELECTRON_RUN_AS_NODE')
    foreach ($key in $Environment.Keys) { $info.Environment[$key] = $Environment[$key] }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    $record = [pscustomobject]@{
        Process = $process
        Name = $Name
        Output = $process.StandardOutput.ReadToEndAsync()
        ErrorOutput = $process.StandardError.ReadToEndAsync()
    }
    $ownedProcesses.Add($record)
    return $record
}

function Save-ProcessLogs($Record) {
    if (-not $Record.Output.Wait(10000) -or -not $Record.ErrorOutput.Wait(10000)) {
        throw 'A test process did not close its output streams.'
    }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "$($Record.Name).stdout.log"),
        $Record.Output.GetAwaiter().GetResult())
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "$($Record.Name).stderr.log"),
        $Record.ErrorOutput.GetAwaiter().GetResult())
}

function Stop-OwnedProcess($Record) {
    if (-not $Record.Process.HasExited) {
        $Record.Process.Kill($true)
        if (-not $Record.Process.WaitForExit(10000)) { throw 'A test process did not stop.' }
    }
    Save-ProcessLogs $Record
}

function Wait-OwnedProcess($Record, [int]$Seconds = 120) {
    if (-not $Record.Process.WaitForExit($Seconds * 1000)) {
        Stop-OwnedProcess $Record
        throw "$($Record.Name) exceeded its $Seconds second timeout."
    }
    Save-ProcessLogs $Record
    if ($Record.Process.ExitCode -ne 0) {
        throw "$($Record.Name) failed with exit code $($Record.Process.ExitCode). See the test logs."
    }
}

function Initialize-InstallerWindowApi {
    # NSIS uses nested native dialogs. Enumerating HWNDs also works when its bootstrap
    # process has no MainWindowHandle or UI Automation omits a nested edit control.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class QuotaInstallerWindow {
    public sealed class Control {
        public long Handle { get; set; }
        public int ProcessId { get; set; }
        public int Id { get; set; }
        public string ClassName { get; set; }
        public string Text { get; set; }
        public bool Visible { get; set; }
        public bool Enabled { get; set; }
        public int Left { get; set; }
        public int Top { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
    }
    private delegate bool Enumerator(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(Enumerator callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, Enumerator callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int capacity);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] private static extern IntPtr SendNumber(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)] private static extern IntPtr SendText(IntPtr window, uint message, UIntPtr wparam, string lparam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)] private static extern IntPtr ReadText(IntPtr window, uint message, UIntPtr wparam, StringBuilder lparam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr context, uint flags);

    private static bool Owned(IntPtr window, int[] owners) {
        uint process;
        GetWindowThreadProcessId(window, out process);
        return Array.IndexOf(owners, (int)process) >= 0;
    }
    private static void RequireOwned(IntPtr window, int[] owners) {
        if (!Owned(window, owners)) throw new InvalidOperationException("The window is not owned by this installer test.");
    }
    private static string Text(IntPtr window) {
        var value = new StringBuilder(2048);
        UIntPtr result;
        ReadText(window, 0x000D, (UIntPtr)2048, value, 2, 1000, out result);
        return value.ToString();
    }
    private static Control Describe(IntPtr window) {
        uint process;
        GetWindowThreadProcessId(window, out process);
        var name = new StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        Rect rectangle;
        GetWindowRect(window, out rectangle);
        return new Control {
            Handle = window.ToInt64(), ProcessId = (int)process, Id = GetDlgCtrlID(window),
            ClassName = name.ToString(), Text = Text(window), Visible = IsWindowVisible(window),
            Enabled = IsWindowEnabled(window), Left = rectangle.Left, Top = rectangle.Top,
            Width = rectangle.Right - rectangle.Left, Height = rectangle.Bottom - rectangle.Top
        };
    }
    public static Control[] Windows(int[] owners) {
        var found = new List<Control>();
        EnumWindows((window, parameter) => {
            if (Owned(window, owners)) found.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }
    public static Control[] Children(long handle, int[] owners) {
        var root = new IntPtr(handle);
        RequireOwned(root, owners);
        var found = new List<Control>();
        EnumChildWindows(root, (window, parameter) => {
            if (Owned(window, owners)) found.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }
    public static bool IsNext(string label) {
        return Regex.IsMatch(label.Replace("&", "").Trim(), @"^(?:Next|下一步(?:\(N\))?|下一頁(?:\(N\))?|下一页(?:\(N\))?)\s*>?$", RegexOptions.IgnoreCase);
    }
    public static void Next(long handle, int[] owners) {
        var window = new IntPtr(handle);
        RequireOwned(window, owners);
        var control = Describe(window);
        // Recheck the live label immediately before dispatch: Install is never accepted.
        if (control.Id != 1 || control.ClassName != "Button" || !control.Visible || !control.Enabled || !IsNext(control.Text))
            throw new InvalidOperationException("Only a visible, enabled Next button can be invoked.");
        UIntPtr result;
        if (SendNumber(window, 0x00F5, UIntPtr.Zero, IntPtr.Zero, 2, 1000, out result) == IntPtr.Zero)
            throw new Win32Exception("The Next button did not respond.");
    }
    public static void Directory(long handle, int[] owners, string value) {
        var window = new IntPtr(handle);
        RequireOwned(window, owners);
        var control = Describe(window);
        if (control.Id != 1019 || control.ClassName != "Edit" || !control.Visible || !control.Enabled)
            throw new InvalidOperationException("The target is not the visible NSIS directory input.");
        UIntPtr result;
        if (SendText(window, 0x000C, UIntPtr.Zero, value, 2, 1000, out result) == IntPtr.Zero || Text(window) != value)
            throw new InvalidOperationException("The directory input did not accept the custom path.");
    }
    public static bool Capture(long handle, int[] owners, IntPtr context) {
        var window = new IntPtr(handle);
        RequireOwned(window, owners);
        return PrintWindow(window, context, 2);
    }
}
'@
    Add-Type -AssemblyName System.Drawing
}

function Update-WizardProcesses($Processes) {
    # Remember process handles/start times. Never adopt an unrelated process merely
    # because Windows recycled a PID, and never inspect command lines or credentials.
    foreach ($parent in @($Processes.Values)) {
        $started = $parent.StartedAt
        $ended = if ($parent.Process.HasExited) { $parent.Process.ExitTime.ToUniversalTime() } else { [DateTime]::MaxValue }
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($parent.Process.Id)" -Property ProcessId, CreationDate)
        foreach ($child in $children) {
            if ($Processes.ContainsKey([int]$child.ProcessId) -or -not $child.CreationDate) { continue }
            $created = $child.CreationDate.ToUniversalTime()
            if ($created -lt $started -or $created -gt $ended) { continue }
            try {
                $process = [Diagnostics.Process]::GetProcessById([int]$child.ProcessId)
                if ($process.SessionId -eq $parent.SessionId -and $process.StartTime.ToUniversalTime() -ge $started -and
                    $process.StartTime.ToUniversalTime() -le $ended) {
                    $Processes.Add($process.Id, [pscustomobject]@{
                        Process = $process; StartedAt = $process.StartTime.ToUniversalTime()
                        SessionId = $process.SessionId; Name = $process.ProcessName
                    })
                }
            } catch [ArgumentException] { }
            catch [InvalidOperationException] { }
            catch [ComponentModel.Win32Exception] { }
        }
    }
    if ($Processes.Count -gt 32) { throw 'The installer spawned an unexpected number of processes.' }
}

function Get-LiveWizardIds($Processes) {
    foreach ($record in $Processes.Values) {
        $record.Process.Refresh()
        if (-not $record.Process.HasExited) { $record.Process.Id }
    }
}

function Save-WizardImage($Window, [int[]]$Owners, [string]$Name) {
    if (-not $Window.Visible -or $Window.Width -le 0 -or $Window.Height -le 0) { return $null }
    $bitmap = [Drawing.Bitmap]::new($Window.Width, $Window.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $context = $graphics.GetHdc()
        try { $captured = [QuotaInstallerWindow]::Capture($Window.Handle, $Owners, $context) }
        finally { $graphics.ReleaseHdc($context) }
        if (-not $captured) { throw 'The installer window could not be rendered for a screenshot.' }
        $image = Join-Path $OutputDirectory $Name
        $bitmap.Save($image, [Drawing.Imaging.ImageFormat]::Png)
        return $Name
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-WizardDiagnostics($Processes, [string]$Name) {
    $owners = [int[]]@(Get-LiveWizardIds $Processes)
    $windows = @([QuotaInstallerWindow]::Windows($owners))
    $details = foreach ($window in $windows) {
        $controls = @()
        try { $controls = @([QuotaInstallerWindow]::Children($window.Handle, $owners)) }
        catch { Write-Warning 'An installer window closed while diagnostics were being collected.' }
        $image = $null
        try { $image = Save-WizardImage $window $owners "$Name-$($window.ProcessId)-$($window.Handle).png" }
        catch { Write-Warning 'Could not capture an owned installer window; its control tree is still recorded.' }
        [pscustomobject]@{ Window = $window; Controls = $controls; Screenshot = $image }
    }
    $processInfo = foreach ($record in $Processes.Values) {
        [pscustomobject]@{ Id = $record.Process.Id; Name = $record.Name; StartedAt = $record.StartedAt; SessionId = $record.SessionId; Exited = $record.Process.HasExited }
    }
    @{ Processes = @($processInfo); Windows = @($details) } | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $OutputDirectory "$Name.json") -Encoding utf8
}

function Test-DirectoryPage {
    Initialize-InstallerWindowApi
    $wizard = Start-OwnedProcess $InstallerPath '/currentuser' 'wizard'
    $processes = [Collections.Generic.Dictionary[int, object]]::new()
    $processes.Add($wizard.Process.Id, [pscustomobject]@{
        Process = $wizard.Process; StartedAt = $wizard.Process.StartTime.ToUniversalTime()
        SessionId = $wizard.Process.SessionId; Name = $wizard.Process.ProcessName
    })
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        $edit = $null
        $selectedWindow = $null
        $navigation = [Collections.Generic.HashSet[string]]::new()
        $step = 0
        while ([DateTime]::UtcNow -lt $deadline) {
            Update-WizardProcesses $processes
            $owners = [int[]]@(Get-LiveWizardIds $processes)
            if ($owners.Count -eq 0) { throw 'All installer processes exited before showing the directory page.' }
            foreach ($window in @([QuotaInstallerWindow]::Windows($owners))) {
                if (-not $window.Visible) { continue }
                $controls = @([QuotaInstallerWindow]::Children($window.Handle, $owners))
                $edits = @($controls | Where-Object { $_.Id -eq 1019 -and $_.ClassName -eq 'Edit' -and $_.Visible })
                $browse = @($controls | Where-Object { $_.Id -eq 1001 -and $_.ClassName -eq 'Button' -and $_.Visible -and $_.Enabled })
                if ($edits.Count -eq 1 -and $browse.Count -eq 1) {
                    $edit = $edits[0]
                    $selectedWindow = $window
                    break
                }
                $next = @($controls | Where-Object {
                    $_.Id -eq 1 -and $_.ClassName -eq 'Button' -and $_.Visible -and $_.Enabled -and
                    [QuotaInstallerWindow]::IsNext($_.Text)
                })
                if ($next.Count -eq 1) {
                    $page = "$($window.Handle):" + (($controls | Where-Object Visible | ForEach-Object { "$($_.Id)=$($_.Text)" }) -join '|')
                    if ($navigation.Add($page)) {
                        if (++$step -gt 6) { throw 'Too many pages appeared before the installation directory page.' }
                        Save-WizardDiagnostics $processes "wizard-before-next-$step"
                        [QuotaInstallerWindow]::Next($next[0].Handle, $owners)
                        Write-Host "Advanced owned installer page $step with its Next button."
                        Start-Sleep -Milliseconds 300
                    }
                }
            }
            if ($edit) { break }
            Start-Sleep -Milliseconds 200
        }
        if (-not $edit) { throw 'The real NSIS directory page was not found. See wizard-failure.json and the owned-window screenshots.' }
        [QuotaInstallerWindow]::Directory($edit.Handle, $owners, $installDirectory)
        Start-Sleep -Milliseconds 300
        $controls = @([QuotaInstallerWindow]::Children($selectedWindow.Handle, $owners))
        $install = @($controls | Where-Object { $_.Id -eq 1 -and $_.ClassName -eq 'Button' -and $_.Visible -and $_.Enabled })
        if ($install.Count -ne 1) { throw 'The directory page did not enable its Install button for the custom path.' }
        $result.directoryPageVerified = $true
        Save-WizardDiagnostics $processes 'wizard-directory-controls'
        try { $result.directoryScreenshot = Save-WizardImage $selectedWindow $owners 'installer-directory-page.png' }
        catch { Write-Warning 'The directory controls were verified, but the runner could not render their screenshot.' }
        Write-Host 'The actual NSIS directory page accepts a custom path; Browse and Install are enabled.'
        # Never press Install in the UI test. The next stage installs silently to the verified path.
    } catch {
        $failure = $_
        try { Update-WizardProcesses $processes }
        catch { Write-Warning 'Could not refresh the installer process tree for diagnostics.' }
        try { Save-WizardDiagnostics $processes 'wizard-failure' }
        catch { Write-Warning "Could not finish installer diagnostics: $($_.Exception.Message)" }
        throw $failure
    } finally {
        foreach ($record in @($processes.Values)) {
            $process = $record.Process
            if ($process.Id -ne $wizard.Process.Id -and -not $process.HasExited) {
                $process.Kill($true)
                [void]$process.WaitForExit(10000)
            }
        }
        Stop-OwnedProcess $wizard
    }
}

function Invoke-TestUninstall {
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { return }
    $remove = Start-OwnedProcess $uninstaller "/S /currentuser _?=$installDirectory" 'uninstall'
    Wait-OwnedProcess $remove
}

if (@(Get-ProductRegistration).Count -ne 0 -or @(Get-InstallationStateKey).Count -ne 0) {
    throw 'An existing Codex Quota Overlay installation was found. Use a fresh disposable CI runner.'
}

try {
    [void](New-Item -ItemType Directory -Path $runRoot)
    $createdTestDirectory = $true
    Write-Host "Installer Authenticode status: $($signature.Status). This test does not measure SmartScreen reputation."
    $probe = Join-Path $runRoot 'write-probe.tmp'
    [IO.File]::WriteAllText($probe, 'Writable custom installation drive')
    Remove-Item -LiteralPath $probe
    if ($SkipWizardUi) {
        Write-Warning 'Directory-page UI verification was explicitly skipped; this run only verifies installation, launch and uninstall.'
    } else {
        Test-DirectoryPage
    }

    $setup = Start-OwnedProcess $InstallerPath "/S /currentuser /D=$installDirectory" 'install'
    Wait-OwnedProcess $setup
    foreach ($relative in @("$product.exe", "Uninstall $product.exe", 'resources\app.asar', 'resources\native\windows\WindowTracker.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installDirectory $relative) -PathType Leaf)) {
            throw "The installed application is missing $relative at the selected path."
        }
    }
    $registration = @(Get-ProductRegistration)
    if ($registration.Count -ne 1 -or $registration[0].PSPath -notmatch 'HKEY_CURRENT_USER' -or
        $registration[0].UninstallString -notlike "*$installDirectory*") {
        throw 'The installed application was not registered for this user at the custom path.'
    }
    $result.installationVerified = $true

    $screenshot = Join-Path $OutputDirectory 'installed-app-preview.png'
    if (Test-Path -LiteralPath $screenshot) { Remove-Item -LiteralPath $screenshot }
    $profile = Join-Path $runRoot 'offline-profile'
    $codex = Join-Path $runRoot 'empty-codex-home'
    [void][IO.Directory]::CreateDirectory($codex)
    $smoke = Start-OwnedProcess $appExecutable "--smoke-test --screenshot `"$screenshot`"" 'smoke' @{
        QUOTA_USER_DATA_DIR = $profile
        CODEX_HOME = $codex
    }
    Wait-OwnedProcess $smoke 45
    if (-not (Test-Path -LiteralPath $screenshot -PathType Leaf) -or (Get-Item -LiteralPath $screenshot).Length -lt 100) {
        throw 'The installed application did not produce an offline preview screenshot.'
    }
    $result.offlineLaunchVerified = $true

    Invoke-TestUninstall
    if ((Test-Path -LiteralPath $appExecutable) -or (Test-Path -LiteralPath (Join-Path $installDirectory 'resources\app.asar')) -or
        @(Get-ProductRegistration).Count -ne 0 -or @(Get-InstallationStateKey).Count -ne 0) {
        throw 'Uninstall left application files or an installation registration behind.'
    }
    $result.uninstallVerified = $true
    $result.fullVerification = $result.directoryPageVerified
    $result.passed = $true
    Write-Host 'Custom-path installation, offline application startup and uninstall all passed.'
} finally {
    foreach ($record in $ownedProcesses) {
        if (-not $record.Process.HasExited) {
            try { Stop-OwnedProcess $record } catch { Write-Warning 'Could not stop a process owned by this test.' }
        }
    }
    if (-not $result.uninstallVerified -and (Test-Path -LiteralPath $uninstaller)) {
        try { Invoke-TestUninstall } catch { Write-Warning 'Cleanup uninstall failed. Discard this CI runner.' }
    }
    # _?= keeps the uninstaller in place while it runs. Remove only this test's unique directory.
    if ($createdTestDirectory -and (Test-Path -LiteralPath $runRoot)) {
        Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction Continue
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Encoding utf8
}
