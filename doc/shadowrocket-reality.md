# Shadowrocket VLESS + Reality URI 适配调研

调研日期：2026-08-27

## 结论

VLESS + TCP + Reality 的可互操作分享链接应采用：

```text
vless://UUID@SERVER:PORT?encryption=none&flow=xtls-rprx-vision&security=reality&sni=SNI&fp=chrome&pbk=PUBLIC_KEY&sid=SHORT_ID&spx=%2F&type=tcp#NAME
```

字段名来自 XTLS/Xray-core 的 VLESS 分享链接提案；该提案规定 URL 参数顺序不敏感，参数值和备注必须进行 `encodeURIComponent` 转义，IPv6 地址必须使用方括号。[Xray-core VLESS/VMess 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)

Shadowrocket 的闭源解析器没有公开一份 Reality 专用 URI 规范。Shadowrocket 官方配置仓库的 VLESS 本地节点示例仍只写了通用 `tls=true`、`peer` 等字段；官方仓库的公开 issue 也明确指出，现有示例没有覆盖 Reality 的 `pbk`、`sid`、`fp`、`sni` 参数。因此以下映射以 Xray-core 第一方分享提案和 Reality 文档为协议依据，并把 Shadowrocket 的实际兼容性列为必须用最新版 App 验收的事项。[Shadowrocket 官方 `default.conf`](https://raw.githubusercontent.com/Shadowrocket/config/master/default.conf)、[Shadowrocket 官方配置 issue #3](https://github.com/Shadowrocket/config/issues/3)

## Clash 字段到 URI 的逐项映射

| Clash/Mihomo 字段 | URI 字段 | 处理结论 |
| --- | --- | --- |
| `type: vless` | `vless://` | 固定协议前缀；UUID 放在 `@` 之前。 |
| `uuid` | authority 的 `UUID` | 必填；对应 Xray 出站用户的 `id`。 |
| `server` | `SERVER` | 必填；域名或 IP。IPv6 输出为 `[2001:db8::1]`；优选 IP 只替换此处。 |
| `port` | `PORT` | 必填，1–65535 的整数。 |
| `network: tcp` | `type=tcp` | `tcp` 是分享链接中的 RAW 传输别名；不要写成 `type=raw`。 |
| `tls: true` + `reality-opts` | `security=reality` | Reality 是传输安全层，不是普通 `security=tls`。 |
| `servername` / `sni` | `sni` | 保留原 SNI，即使 `server` 被替换为优选 IP；必须匹配服务端 `serverNames`。 |
| `flow` | `flow` | 原样传递，例如 `xtls-rprx-vision`；缺失时省略，不凭空生成。 |
| `encryption` | `encryption` | VLESS 负载加密字段；通常显式输出 `encryption=none`。不要把它与传输安全字段 `security` 混用。 |
| `client-fingerprint` / `fingerprint` | `fp` | Reality 客户端必填；常见值为 `chrome`。`unsafe` 不适用于 Reality。 |
| `reality-opts.public-key` | `pbk` | URI 使用历史别名 `pbk`；Xray 当前 JSON 文档把客户端字段称为 `password`，旧文档常称 `publicKey`。 |
| `reality-opts.short-id` | `sid` | 原样传递；Xray 要求偶数个十六进制字符、最多 16 个字符，服务端允许空值时可为空。 |
| `reality-opts.spider-x`（若上游提供） | `spx` | 映射到 `spiderX`，必须 URL 编码；没有该字段时省略。 |
| `skip-cert-verify` / `allowInsecure` | 无可靠 Reality 映射 | 不要转换为 `allowInsecure=1`；Xray 分享提案没有该字段，且 Xray-core 已移除 `allowInsecure`。 |

字段定义依据是 Xray 分享提案对 `uuid`、远端地址/端口、`type`、`encryption`、`flow`、`security`、`fp`、`sni`、`pbk`、`sid`、`spx` 的说明。[Xray-core 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)

## TCP Reality 的额外要求

Xray 官方 Reality 文档规定：客户端 `serverName` 必须是服务端允许的 `serverNames` 之一；`fingerprint` 必填；`shortId` 必须匹配服务端的 `shortIds`；`password` 是服务端私钥对应的客户端公钥；`spiderX` 是可选的初始爬虫路径与参数。[Xray Reality 配置文档（中文）](https://xtls.github.io/config/transports/reality.html)

Xray 官方传输兼容表规定 Reality 只能与 RAW、XHTTP、gRPC 组合，不能与 WebSocket、HTTPUpgrade、mKCP 组合；VLESS 分享链接的 `type=tcp` 对应 RAW。因此首版只承诺 TCP Reality 时，最小安全输出就是 `type=tcp` 加 `security=reality` 及上述 Reality 参数，不需要 WebSocket 的 `host/path`。[Xray 传输配置与兼容表](https://xtls.github.io/en/config/transport.html)、[Xray VLESS 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)

TCP 的 `tcpSettings.header.type=http` 属于旧式 TCP HTTP 伪装；Xray 分享提案的当前字段定义没有给出通用、稳定的 `headerType` 映射，相关讨论也认为这类 request/response 伪装不适合直接分享。遇到 TCP HTTP 伪装时，应跳过或另行测试，不要仅添加 `headerType=none` 就声称完整保真。[分享提案中的 TCP HTTP 伪装讨论](https://github.com/XTLS/Xray-core/discussions/716)

## 可直接使用的示例

假设 Clash 节点包含：

```yaml
type: vless
server: 203.0.113.10
port: 443
uuid: 11111111-2222-4333-8444-555555555555
network: tcp
tls: true
flow: xtls-rprx-vision
servername: www.example.com
client-fingerprint: chrome
reality-opts:
  public-key: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk
  short-id: 0123456789abcdef
```

应序列化为类似：

```text
vless://11111111-2222-4333-8444-555555555555@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.com&fp=chrome&pbk=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk&sid=0123456789abcdef&type=tcp#节点名称
```

备注中的中文、空格和特殊字符必须编码，例如 `#节点名称` 应输出为 `#%E8%8A%82%E7%82%B9%E5%90%8D%E7%A7%B0`；Reality `spx=/` 应输出为 `spx=%2F`。[Xray-core 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)

优选 IP 场景可以改为 `vless://UUID@203.0.113.10:443?...&security=reality&sni=原始伪装域名&fp=chrome&pbk=...&sid=...#名称`；连接地址可以变为 IP，但 `sni`、`fp`、`pbk`、`sid`、`flow` 必须保留。TCP Reality 没有 WebSocket Host/Path 可供替换。[Xray Reality 配置文档](https://xtls.github.io/config/transports/reality.html)

## Shadowrocket 导入证据

Shadowrocket 官方仓库没有公开 Reality URI 的字段白名单或解析源码。其官方 `default.conf` 只提供通用 VLESS 本地节点写法；官方配置仓库的公开 issue 以“VLESS + XHTTP + Reality 无法从现有示例转换”为问题，列出了 `security=reality`、`pbk`、`sid`、`fp`、`sni` 等典型 URI，但没有给出官方解析规则或完整 `[Proxy]` 写法。[Shadowrocket 官方 `default.conf`](https://raw.githubusercontent.com/Shadowrocket/config/master/default.conf)、[Shadowrocket 官方配置 issue #3](https://github.com/Shadowrocket/config/issues/3)

社区维护、基于 Shadowrocket 官方群组资料整理的手册确认可以复制 `vless://` 链接后自动导入，或在 `+` 中选择 `Subscribe` 添加订阅；这只能证明导入入口，不能替代 Reality 字段的版本化真机测试。[社区手册（非官方）](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md)

## `allowInsecure` 的处理

`allowInsecure` 不属于当前 Xray VLESS/Reality 分享链接字段。Xray-core 分享提案没有加入它；当前 Xray TLS 文档建议用 `pcs`（证书 SHA-256 pin）和 `vcn`（按名称验证证书）替代，Xray-core 发布说明也记录了 `allowInsecure` 的移除。[Xray-core 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)、[Xray-core 发布说明](https://github.com/XTLS/Xray-core/releases)

Shadowrocket 旧版或其他客户端可能接受一个名为 `allowInsecure` 的查询参数，但 Shadowrocket 官方公开资料没有给出 Reality 下该参数的行为契约。建议：

- 对 Reality 节点忽略 `skip-cert-verify` 和 `allowInsecure`，不输出 `allowInsecure=1`。
- 对普通 VLESS/Trojan + TLS 是否保留现有 `allowInsecure` 逻辑，另按普通 TLS 兼容性处理，不要与 Reality 共用判断。
- 若未来需要证书 pinning，需确认 Shadowrocket 是否支持 `pcs`/`vcn`，目前不能从公开资料推断。

## 当前项目的实现建议

1. `network` 为 `tcp` 且 Reality 参数完整时，输出 `vless://` 标准链接；将 `server` 替换为优选 IP 时保留 `sni`。
2. Reality 必须检查 `uuid`、`server`、`port`、`client-fingerprint`、`public-key`、`short-id`；缺少必填项就跳过并记录原因。`sid` 是否允许空值应由上游/服务端契约决定，不能统一把空值当作缺失。
3. `pbk`、`sid`、`spx`、`sni`、备注都按 URI 组件编码；不要使用手写字符串拼接绕过 `URLSearchParams` 的编码规则。
4. 首版只接受 TCP/RAW Reality。`ws + reality` 明确不兼容；`grpc/xhttp + reality` 虽被 Xray 支持，但 Shadowrocket 官方资料没有公开完整字段映射，应单独做版本化验收后再开放。[Xray 传输兼容表](https://xtls.github.io/en/config/transport.html)、[Shadowrocket 官方配置 issue #3](https://github.com/Shadowrocket/config/issues/3)
5. 输出后先 Base64 解码，断言 URI 包含 `security=reality`、`type=tcp`、`sni`、`fp`、`pbk`、`sid`，再进行最新版 Shadowrocket 真机导入和连接测试。官方仓库当前没有可替代真机验收的 Reality 解析测试套件。

## 未知项与风险

- Shadowrocket 的 URI 解析器和 Reality 字段实现是闭源的；官方仓库没有公开“支持字段白名单”或版本兼容矩阵。`pbk/sid/fp/sni` 的组合有大量跨客户端实践，但不能仅凭社区示例宣称所有 Shadowrocket 版本都支持。[Shadowrocket 官方配置 issue #3](https://github.com/Shadowrocket/config/issues/3)
- Xray 分享提案会随协议演进；提案作者提醒 VLESS 分享字段可能发生不兼容变化。实现应保留未知参数跳过策略和版本化测试。[Xray-core 分享链接提案](https://github.com/XTLS/Xray-core/discussions/716)
- Reality 的客户端 `pbk` 在 Xray 当前文档中称为 `password`，这是字段重命名而不是密码值变化；从 Clash 的 `reality-opts.public-key` 读取后仍应放入 URI 的 `pbk`。[Xray Reality 配置文档](https://xtls.github.io/config/transports/reality.html)
