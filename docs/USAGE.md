# 安装与使用 / Installation and usage

## 要求

- macOS 13+，Apple Silicon 或 Intel；Windows 10/11 x64。
- 已安装官方 Codex，使用 ChatGPT 账号登录。Linux 暂未实现窗口跟随。
- 本机存在 Codex 原生 CLI，以及可读取的 ChatGPT 文件登录信息。API key 模式、自定义供应商和仅钥匙串存储暂不支持。

## 下载

仅从本项目 [Releases](https://github.com/aiximi/codex-quota-overlay/releases/latest) 下载对应架构文件。macOS 在“关于本机”查看芯片类型；Windows 下载 x64 安装版或便携版。

macOS 打开 DMG 后将应用拖到 Applications。Windows 运行 `setup.exe`，默认按当前用户安装；便携版无需安装。首次启动只需同意操作系统针对该应用的允许提示，不需要管理员身份、不需要禁用系统级安全功能。

当前构建为社区未公证/未 Authenticode 签名版本。macOS 可以在“系统设置 → 隐私与安全性”查看该应用的允许打开入口；Windows 可以查看文件发布者和下载来源。若企业策略阻止运行，请联系设备管理员，不要绕过组织策略。

校验示例（将文件名换成实际下载文件）：

```sh
# macOS
shasum -a 256 Codex-Quota-Overlay-2.0.0-mac-arm64.dmg
```

```powershell
# Windows
Get-FileHash .\Codex-Quota-Overlay-2.0.0-windows-x64-setup.exe -Algorithm SHA256
```

将输出与同一发布页的 `SHA256SUMS.txt` 对照。

## 日常操作

1. 切换到 Codex 后显示浮层。点击标题栏展开或收起，拖动最左侧的小点调整位置。
2. 展开可查看官方额度周期、自然重置时间、重置机会到期时间、额外额度和订阅日期。
3. 点击刷新立即查询；默认每 60 秒同步，前台使用时按设置更新。倒计时在本机每秒计算。
4. 点击齿轮，或系统托盘/菜单栏图标，打开设置。设置窗口可以输入文字；浮层不会抢占 Codex 的键盘焦点。
5. 可选登录时自动启动。退出应用用托盘菜单的“退出”。

### 使用重置机会

每条机会右侧的按钮只作用于该条机会。第一次点击打开确认框，核对到期时间后，再点“确认消耗 1 次”才会提交。默认按钮是取消。

成功后自动查询最新用量，不在本机假定哪些周期已恢复。服务端返回“没有符合条件的额度”时不会消耗机会。网络断开或结果不明时不会自动重试，也不会自动改用另一条；原条目会显示“重试”，再次确认沿用同一次操作的标识。其他机会暂时禁用，直到原操作状态明确。

**开发、截图与测试不得兑换真实机会。** `npm run preview` 使用示例数据，完全禁用真实重置。

### 订阅日期

自动续费时显示续费日期，其余情况显示到期日期。接口不可用时显示未获取或上次确认记录。设置中可填写日期、选择是否自动续费；手动记录会标注来源且按账号隔离。“恢复自动”删除当前账号的手动日期。

自然周额度重置日、重置机会到期日、订阅续费日彼此独立。时间以本机时区显示。额外额度直接显示官方余额，不能当作美元、人民币或剩余消息数。

## 常见问题

| 情况                    | 处理                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| 看不到浮层              | 确认正在使用官方 Codex 且窗口不是最小化；托盘 → 恢复位置；重启浮层。                             |
| 找不到 CLI              | 设置中选择 Codex 安装目录内真实的 `codex` / `codex.exe`，不要选 `.cmd` 或 shell 脚本。           |
| 提示先登录              | 确认 ChatGPT 登录信息存储于 `~/.codex/auth.json` 或 `CODEX_HOME` 对应目录；不支持 API key 方式。 |
| 订阅日期未获取          | 此接口可能不可用，在设置中按账单填写日期。                                                       |
| 重置按钮灰色            | 等待同步；检查机会是否到期、已处理，或有上次结果待确认。预览模式始终禁用。                       |
| 网络失败                | 保留上次用量并标记错误。检查现有系统代理和网络，稍后手动刷新。                                   |
| Windows helper 启动失败 | 检查是否被组织脚本策略限制。helper 的进程级策略不修改系统策略，也不覆盖组织策略。                |
| Codex 更新后无法使用    | 报告应用和系统版本，附重现步骤；不要上传 token、auth.json 或私人日志。                           |

## 更新与卸载

下载新发行版，退出旧应用后替换/安装。当前没有自动更新器。卸载前可以关闭登录启动；Windows 从“已安装的应用”卸载，macOS 删除 Applications 中的应用，便携版删除下载文件。

本地设置位于 Electron 当前用户数据目录：macOS 的 `~/Library/Application Support/Codex Quota Overlay/`，Windows 的 `%APPDATA%/Codex Quota Overlay/`。未明确核对的重置记录也在其中。**存在结果不明的重置时，不要删除设置来尝试重置另一条。** 开发者 Git 同步需单独运行 `npm run sync:uninstall` 停止，删除应用不会删除开发仓库或同步服务。

## English quick guide

Install official Codex and sign in with a supported ChatGPT file-based login. Download the matching package, verify its checksum, and run the overlay. Switch to Codex to see the capsule; click to expand, use the left grip to drag, and open Settings from the tray/menu bar.

Each Reset button selects one credit and opens a confirmation whose default is Cancel. The app never automatically redeems credits. Network uncertainty retains the operation ID; retry the same item after reviewing refreshed data. Preview is fully offline and cannot redeem a real credit.

Subscription dates are best-effort official lookups or explicitly labelled cached/manual entries. Set a date manually if the account endpoint is unavailable. To update, quit and install the new release. Community packages are currently unsigned/unnotarized; use only OS per-app approval after verifying the source, never disable global security.
