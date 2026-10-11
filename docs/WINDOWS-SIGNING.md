# Windows 代码签名：申请、费用与发布

核对日期：2026-10-11。价格、服务地区和申请条件可能变化，下单或申请前应重新查看链接中的官方条款。

代码签名验证发布者身份以及签名后文件是否被修改。它不代表微软替项目完成了功能测试，也不保证没有漏洞。SmartScreen 还会判断发布者与文件信誉，新文件即使有有效签名也可能显示提示；EV 证书也不再保证立即免提示。见 [微软 SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

## 当前状态

本项目当前 `v2.0.0` 的 Windows 文件未做 Authenticode 签名。尚未申请或获得任何下列服务，也没有开通付费订阅。安装和目录选择说明见 [USAGE.md](USAGE.md)。

## 可选方式与费用

| 方式                                                                                                                   | 官方公布的费用                         | 对本项目的适用性与限制                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [SignPath Foundation](https://signpath.org/apply.html)                                                                 | 符合条件的开源项目免费                 | 可申请审核；要求开源、维护、公开发行、双重验证和可核验的构建来源。基金会保留审批权，新仓库不能保证获批；证书发布者是基金会。  |
| [Certum 开源云签名](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)                                | 页面标价 **€49 起**                    | 当前商品页显示缺货；需先确认供货、期限、税费、所在地和证件能否验证。开源方案仅签发给个人，并限制商业分发用途。                |
| [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)   | 约 **US$9.99/月**                      | 个人目前仅支持美国、加拿大；组织支持美国、加拿大、欧盟、英国。中国大陆个人目前不在该申请范围。需要付费 Azure 订阅和身份验证。 |
| [传统 CA 的 OV 证书](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)           | 微软给出的参考范围为 **US$150–300/年** | 具体报价、云签名或硬件设备费用、支持国家及验证材料以所选 CA 为准。                                                            |
| [Microsoft Store 的 MSIX 分发](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) | 商店为 MSIX 重签名免费                 | 需另外适配 MSIX、注册开发者并通过上架审核；不是给现有 GitHub EXE 自动免费签名。Store 的 MSI/EXE 提交仍需要发布者自己签名。    |

对当前公开 MIT 项目，可以优先评估 SignPath 免费申请。若需要用自己的个人或公司身份签名，再核对商业 CA 的条件和总费用。不要仅为消除 SmartScreen 提示而购买更贵的 EV 证书。

## 免费申请 SignPath 的步骤

1. 阅读 [申请条件](https://signpath.org/terms.html)。确认项目及随包组件符合其开源要求，并核对隐私、卸载和构建来源要求。
2. 在你自己的 GitHub 和 SignPath 账号中启用双重验证。身份资料、验证口令和恢复码由你本人保管，不提交到本仓库。
3. 打开 [申请入口](https://signpath.org/apply.html)，按表单要求填写维护者联系方式、项目介绍、仓库、许可证和已有发布链接。
4. 提供可核验的源码与构建记录，等待其审核。基金会会考虑项目声誉；目前这个项目刚公开，不能承诺审核通过或给出固定时限。
5. 获批后再按服务要求建立签名策略，接入 GitHub Actions。需要明确谁审核源码、谁批准签名；其当前条件要求每次发行人工批准签名，因此代码自动同步与发行签名批准是两件事。
6. 对包内应用程序及最终安装器、便携版启动器完成签名和时间戳，验证 Authenticode 状态，随后重新计算 SHA-256 并发布。

可用于申请的已有公开资料：

- 项目：Codex Quota Overlay。
- 仓库：<https://github.com/aiximi/codex-quota-overlay>。
- 许可证：MIT。
- 已有发行：<https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.0.0>。
- 用途：在用户运行 Codex 时显示账号额度、重置时间与订阅日期；重置需要用户再次确认。
- 隐私说明：[PRIVACY.md](PRIVACY.md)；构建流程：[CI](../.github/workflows/ci.yml)。

获批之前，不应在 README 写“已由 SignPath 提供签名”。现有开源协议也不等于已获得该服务资格。

## 付费证书通常怎么申请

以 Certum 开源个人方案为例：先确认供货和你的所在地/身份证件是否可验证，再创建官网账号并选择相符的代码签名产品。购买后，在供应商的认证页面完成个人身份验证，按要求补交地址证明和公开项目地址；公司方案还可能需要注册资料及申请人的授权证明。具体要求以 [Certum 官方材料清单](https://support.certum.eu/en/code-signing-required-documents/) 为准。

其云方案使用 SimplySign 手机应用和桌面组件，不需要另购实体读卡器；但“云签名”不自动意味着可直接无人值守接入 GitHub Actions。购买前还应核对自动化签名方式，见 [产品技术要求](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)。

身份证、护照、地址证明、支付信息、签名私钥和恢复码只提交到供应商的正式安全入口。不要发到 Issue、源码仓库或聊天。GitHub 的普通账号验证、GitHub CLI 的 workflow 授权和域名 HTTPS 证书，都不能替代 Windows 代码签名。

## Microsoft Artifact Signing 的办理顺序

先确认身份所在地区符合要求，再准备支持的付费 Azure 订阅，创建 Artifact Signing 资源，完成个人或组织身份验证并建立 Public Trust 证书配置。身份通过后，为发布流程配置最小范围的签名权限并验证输出。免费、试用或赞助 Azure 订阅不支持该服务，见 [官方 FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)。

当前只提供方案和申请步骤，未替任何维护者注册、提交身份材料、同意服务条款或购买服务。
