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

function Find-Control($Window, [string]$Id, $Type) {
    $condition = [Windows.Automation.AndCondition]::new(
        [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $Id),
        [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
    )
    return $Window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}

function Test-DirectoryPage {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $wizard = Start-OwnedProcess $InstallerPath '/currentuser' 'wizard'
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $edit = $null
        $window = $null
        while ([DateTime]::UtcNow -lt $deadline) {
            $wizard.Process.Refresh()
            if ($wizard.Process.HasExited) { throw 'The installation wizard exited before showing its directory page.' }
            if ($wizard.Process.MainWindowHandle -ne [IntPtr]::Zero) {
                $window = [Windows.Automation.AutomationElement]::FromHandle($wizard.Process.MainWindowHandle)
                $edit = Find-Control $window '1019' ([Windows.Automation.ControlType]::Edit)
                if ($edit -and -not $edit.Current.IsOffscreen) { break }
            }
            Start-Sleep -Milliseconds 200
        }
        if (-not $edit -or $edit.Current.IsOffscreen) {
            throw 'The real NSIS directory page was not visible. Keep oneClick=false and allowToChangeInstallationDirectory=true.'
        }
        $browse = Find-Control $window '1001' ([Windows.Automation.ControlType]::Button)
        $install = Find-Control $window '1' ([Windows.Automation.ControlType]::Button)
        if (-not $browse -or -not $browse.Current.IsEnabled -or -not $edit.Current.IsEnabled) {
            throw 'The directory input or Browse button is unavailable.'
        }
        $value = $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
        if ($value.Current.IsReadOnly) { throw 'The installation directory input is read-only.' }
        $value.SetValue($installDirectory)
        $edit.SetFocus()
        Start-Sleep -Milliseconds 300
        if ($value.Current.Value -ne $installDirectory -or -not $install -or -not $install.Current.IsEnabled) {
            throw 'The directory page did not accept the custom installation path.'
        }
        $result.directoryPageVerified = $true
        try {
            Add-Type -AssemblyName System.Drawing
            $bounds = $window.Current.BoundingRectangle
            $bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
                $image = Join-Path $OutputDirectory 'installer-directory-page.png'
                $bitmap.Save($image, [Drawing.Imaging.ImageFormat]::Png)
                $result.directoryScreenshot = [IO.Path]::GetFileName($image)
            } finally {
                $graphics.Dispose()
                $bitmap.Dispose()
            }
        } catch {
            Write-Warning 'Directory controls were verified, but this runner could not capture the installer window.'
        }
        Write-Host 'The actual NSIS directory page accepts a custom path; Browse and Install are enabled.'
        # Deliberately stop before pressing Install. The next stage tests a controlled silent installation.
    } finally {
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
