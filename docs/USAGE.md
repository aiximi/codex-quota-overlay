# 安装与使用 / Installation and usage

## 要求

- macOS 13+，Apple Silicon 或 Intel；Windows 10/11 x64。
- 已安装官方 Codex，使用 ChatGPT 账号登录。Linux 暂未实现窗口跟随。
- 本机存在 Codex 原生 CLI，以及可读取的 ChatGPT 文件登录信息。API key 模式、自定义供应商和仅钥匙串存储暂不支持。

## 下载

从本项目 [下载中心](../DOWNLOADS.md) 选择对应系统的最新版本，历史安装包和每次变化见 [版本历史](VERSIONS.md)。各平台独立发布：Windows 2.0.1 是 Windows 专用修复版，macOS 仍使用 2.0.0，不需要寻找 macOS 2.0.1。

macOS 在“关于本机”查看芯片类型，选择 Apple Silicon 或 Intel；Windows 下载 x64 安装版或便携版。下载中心链接均指向本仓库的 GitHub 发布文件。

macOS 打开 DMG 后将应用拖到 Applications。当前 macOS 构建没有 Apple Developer ID 公证，可以在“系统设置 → 隐私与安全性”查看该应用的允许打开入口。

校验示例（将文件名换成实际下载文件）：

```sh
# macOS
shasum -a 256 Codex-Quota-Overlay-2.0.0-mac-arm64.dmg
```

```powershell
# Windows
Get-FileHash .\Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe -Algorithm SHA256
```

将输出与同一发布页的 `SHA256SUMS.txt` 对照。

### Windows 安装版：选择盘符和目录

1. 下载 `Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe` 并核对同一发布页的 SHA-256。
2. 运行文件；如出现 SmartScreen 提示，先按下节核对并决定是否继续。**此提示发生在安装向导之前，还没有进入目录选择页。**
3. 在安装向导的目录选择页点击“浏览”，或直接填写目标目录，例如 `D:\Apps\Codex Quota Overlay`。也可以选择其他存在的盘符。
4. 当前账号对目标目录有写权限即可按当前用户安装；如果目录不可写，请选择有权限的位置，再继续安装。

### Windows 便携版

`Codex-Quota-Overlay-2.0.1-windows-x64-portable.exe` 无需安装，也没有安装目录选择页。把文件放到想用的盘符，例如 `D:\Apps\Codex Quota Overlay\`，再双击运行即可。

“便携”指无需安装程序；设置、订阅记录和重置状态仍保存在当前用户的 `%APPDATA%\Codex Quota Overlay\`，不会随 EXE 一起移动。安装版选择其他盘符也不会改变该用户数据位置。

### Windows SmartScreen“未识别的应用”

当前 Windows 包未经过 Authenticode 签名，新版本尚需积累下载信誉；签名也不保证新文件不会出现 SmartScreen 提示。“未识别的应用”本身不是病毒检测结论，也不能据此证明文件安全。参见 [Microsoft 的 SmartScreen 信誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

确认文件来自本仓库的发布页，且 SHA-256 与同一发布页一致后，如果你决定信任此下载，并且系统提供该入口，可以自行点击 **“更多信息 → 仍要运行”**，随后才会打开安装向导或便携应用。校验值用于确认文件与发布包一致，不能代替来源判断。

如果企业策略或 Windows 11 的 **Smart App Control** 直接阻止运行，可能没有“仍要运行”选项。请联系设备管理员，或等待符合设备策略的发行方式；**不要为了安装本应用关闭 SmartScreen、Smart App Control 或其他全局安全保护**。本版本没有宣称解决或绕过这些系统限制。

## 日常操作

1. 切换到 Codex 后显示浮层。点击标题栏展开或收起，拖动最左侧的小点调整位置。
2. 展开可查看官方额度周期、自然重置时间、重置机会到期时间、额外额度和订阅日期。
3. 点击刷新立即查询；默认每 60 秒同步，前台使用时按设置更新。倒计时在本机每秒计算。
4. 点击齿轮，或系统托盘/菜单栏图标，打开设置。浮层出现时不会抢占 Codex 的键盘焦点；Windows 点击浮层后可正常使用鼠标与键盘，点击回 Codex 可继续输入。
5. 可选登录时自动启动。退出应用用托盘菜单的“退出”。

### 使用重置机会

每条机会右侧的按钮只作用于该条机会。第一次点击打开确认框，核对到期时间后，再点“确认消耗 1 次”才会提交。默认按钮是取消。

成功后自动查询最新用量，不在本机假定哪些周期已恢复。服务端返回“没有符合条件的额度”时不会消耗机会。网络断开或结果不明时不会自动重试，也不会自动改用另一条；原条目会显示“重试”，再次确认沿用同一次操作的标识。其他机会暂时禁用，直到原操作状态明确。

**开发、截图与测试不得兑换真实机会。** `npm run preview` 使用示例数据，完全禁用真实重置。

### 订阅日期

自动续费时显示续费日期，其余情况显示到期日期。接口不可用时显示未获取或上次确认记录。设置中可填写日期、选择是否自动续费；手动记录会标注来源且按账号隔离。“恢复自动”删除当前账号的手动日期。

自然周额度重置日、重置机会到期日、订阅续费日彼此独立。时间以本机时区显示。额外额度直接显示官方余额，不能当作美元、人民币或剩余消息数。

## 常见问题

| 情况                     | 处理                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 看不到浮层               | 确认正在使用官方 Codex 且窗口不是最小化；托盘 → 恢复位置；重启浮层。                                                           |
| 找不到 CLI               | Windows 优先清空设置中的旧 CLI 路径以自动查找；手动选择时须用可执行的原生 `codex` / `codex.exe`，不要选 `.cmd` 或 shell 脚本。 |
| 提示先登录               | 确认 ChatGPT 登录信息存储于 `~/.codex/auth.json` 或 `CODEX_HOME` 对应目录；不支持 API key 方式。                               |
| 订阅日期未获取           | 此接口可能不可用，在设置中按账单填写日期。                                                                                     |
| 重置按钮灰色             | 等待同步；检查机会是否到期、已处理，或有上次结果待确认。预览模式始终禁用。                                                     |
| 网络失败                 | 保留上次用量并标记错误。检查现有系统代理和网络，稍后手动刷新。                                                                 |
| Windows helper 启动失败  | 检查是否被组织脚本策略限制。helper 的进程级策略不修改系统策略，也不覆盖组织策略。                                              |
| Windows 没有出现目录选择 | 先确认下载的是 `setup.exe`；SmartScreen 提示在安装向导之前，`portable.exe` 没有目录选择页。                                    |
| Windows 安装目录不可写   | 在向导中浏览到当前账号有写权限的目录，例如 `D:\Apps\Codex Quota Overlay`。                                                     |
| Codex 更新后无法使用     | 报告应用和系统版本，附重现步骤；不要上传 token、auth.json 或私人日志。                                                         |

## 更新与卸载

### Windows 2.0.1：修复点击、跟随与额度显示

旧版 Windows 窗口使用不可获得焦点的原生窗口，可能显示面板却无法正常点击。修复版允许点击时获得焦点，同时保留与 Codex 的窗口关联；切换其他应用或最小化 Codex 后仍会隐藏。拖动完成后才保存位置，避免每次移动同步写盘。

如果同时一直显示 `—`，修复版会自动寻找 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe`，并使用当前 Windows CLI 要求的无参数额度查询。更新后无需手动填写带版本号的路径；此前手动指定过旧路径的用户可在设置中清空 CLI 路径，恢复自动查找。额度读取成功后会先显示，订阅日期可能稍后返回。

这些修复已发布为 **Windows 2.0.1**，详情见 [本次版本说明](releases/windows-v2.0.1.md)。这是仅 Windows 的更新，macOS 继续使用原 2.0.0 安装包，窗口和额度请求方式保持原样。

1. 在 [下载中心](../DOWNLOADS.md) 下载对应系统的版本，并核对该发布页的校验值。
2. 通过系统托盘/菜单栏的“退出”结束旧浮层。关闭 Codex 窗口不等于退出浮层，不要同时运行旧版和新版。
3. Windows 安装版运行新 `setup.exe`；便携版退出旧程序后替换 EXE，再启动新文件。macOS 退出旧应用后替换 Applications 中的应用。
4. 切换到 Codex 检查点击和用量显示；Windows 若曾指定失效的 CLI 路径，在设置中清空它，恢复自动查找。

当前没有自动更新器；拉取 Git 源码也不会替换已经安装的程序。Windows 安装版选择盘符的功能在 2.0.0 已有，2.0.1 仍然保留。当前 Windows 包仍未签名，升级不代表 SmartScreen 提示已经消除。

卸载前可以关闭登录启动；Windows 从“已安装的应用”卸载，macOS 删除 Applications 中的应用，便携版删除下载文件。

本地设置位于 Electron 当前用户数据目录：macOS 的 `~/Library/Application Support/Codex Quota Overlay/`，Windows 的 `%APPDATA%/Codex Quota Overlay/`。未明确核对的重置记录也在其中。**存在结果不明的重置时，不要删除设置来尝试重置另一条。** 开发者 Git 同步需单独运行 `npm run sync:uninstall` 停止，删除应用不会删除开发仓库或同步服务。

## English quick guide

Install official Codex and sign in with a supported ChatGPT file-based login. Select your platform in the [download center](../DOWNLOADS.md), verify the matching release checksum, and run the overlay. The [version history](VERSIONS.md) includes older downloads and each release's changes. Switch to Codex to see the capsule; click to expand, use the left grip to drag, and open Settings from the tray/menu bar.

Each Reset button selects one credit and opens a confirmation whose default is Cancel. The app never automatically redeems credits. Network uncertainty retains the operation ID; retry the same item after reviewing refreshed data. Preview is fully offline and cannot redeem a real credit.

Subscription dates are best-effort official lookups or explicitly labelled cached/manual entries. Set a date manually if the account endpoint is unavailable.

**Windows 2.0.1 is a Windows-only update; macOS remains on 2.0.0.** It fixes native mouse/keyboard input, Codex window tracking during overlay interaction, managed CLI discovery, and the Windows quota request. Usage can now appear before the optional subscription lookup completes. See the [release details](releases/windows-v2.0.1.md).

Before updating, quit the old overlay through its tray/menu-bar menu; closing Codex alone does not stop it. Run the new Windows installer or replace the portable EXE after quitting. Do not run both versions together. Clear any obsolete manual CLI path in Settings to restore automatic discovery. There is no auto-updater, and pulling source changes does not update an installed binary. These Windows builds remain unsigned; the update does not remove SmartScreen restrictions.

### Windows installation and drive selection

1. Download `Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe` through the [download center](../DOWNLOADS.md) and compare its SHA-256 with `SHA256SUMS.txt` from the same release.
2. Run the file. Any SmartScreen warning appears **before** the installation wizard and its directory page.
3. On the directory page, choose **Browse** or enter a location such as `D:\Apps\Codex Quota Overlay`. You may select another drive. Installation is per-user; your account needs write permission to that directory.
4. Continue through the wizard. If the directory is not writable, choose a location your account can write to.

`Codex-Quota-Overlay-2.0.1-windows-x64-portable.exe` has no installation-directory selection. Place it on your preferred drive and run it there. Both versions keep settings, subscription entries and reset state in `%APPDATA%\Codex Quota Overlay\`; moving the executable does not move this data. Custom installation directories were already supported in 2.0.0.

### Windows SmartScreen warning

Current Windows builds are unsigned. New files need reputation, and signing would not guarantee no warnings. “Unrecognized app” alone is not a malware verdict or a guarantee of safety. See [Microsoft's guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

After checking the release source and SHA-256, you may select **More info → Run anyway** if offered and you trust the download. Enterprise policy or Smart App Control may prevent this option. Keep global protection enabled; contact your administrator or wait for a release that meets your device's policy. This release does not claim to remove or bypass those restrictions.
