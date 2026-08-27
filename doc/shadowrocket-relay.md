# Shadowrocket 链式代理适配调研

调研日期：2026-08-27

## 结论摘要

当前 Clash 配置中的加拿大节点是一个普通 SS 节点，靠 `dialer-proxy: "🪜 链式前置"` 指定其出站连接经过前置节点；它不是 Shadowrocket 的 `Relay`（GOST Relay）协议节点。Mihomo 文档将 `dialer-proxy` 定义为“通过另一个代理拨号”，并说明旧的 `relay` 策略已弃用，建议使用该字段。[Mihomo `dialer-proxy` 文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxies/dialer-proxy.en.md)、[Mihomo `relay` 文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxy-groups/relay.en.md)

Shadowrocket 可以表达相同关系：节点 A 的连接“通过”节点 B，流量顺序为 `Client > B > A > Web server`，并支持多级链和代理组作为中间节点。但目前公开的字段说明来自社区整理的手册，不是 Shadowrocket 官方公开的 URI 规范。[Shadowrocket 使用手册（基于官方文档整理）](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

## 官方证据、社区实证与未知项

Shadowrocket 官方 App Store 版本说明持续提到链式代理：2.2.90 提到 `Chain Sockets` 及链式代理中的 SOCKS5 UDP relay，2.2.79 修复 server chain lookup，2.2.67 修复 server chain 大小写和订阅 proxy pass 问题。这能证实客户端存在并维护该能力，但没有公布 `chain` URI 参数或节点引用的正式语法。[Shadowrocket App Store 版本历史](https://apps.apple.com/us/app/shadowrocket/id932747118)

官方 GitHub 组织公开了 `config`、`manual` 等仓库；其中 `manual` 当前为空，`default.conf` 只展示通用节点配置语法，没有 `chain`、`dialer-proxy` 或 `underlying-proxy` 的公开字段定义。因此，下面关于过滤脚本字段和 `chain=` URI 的内容应分别标为“社区手册记录”和“主流转换器实现”，不能当作厂商稳定契约。[Shadowrocket 官方 GitHub 组织](https://github.com/Shadowrocket)、[官方 manual 仓库](https://github.com/Shadowrocket/manual)、[官方 default.conf](https://raw.githubusercontent.com/Shadowrocket/config/master/default.conf)

已证实与未知项应分开处理：

- 已证实：客户端具有链式代理功能，且官方版本历史曾修复链查找及订阅 proxy pass；Mihomo 的 `dialer-proxy` 是 Clash/Mihomo 配置字段。[App Store 版本历史](https://apps.apple.com/us/app/shadowrocket/id932747118)、[Mihomo `dialer-proxy` 文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxies/dialer-proxy.en.md)
- 社区实证：过滤脚本可写 `$server.chain` 或 `$server['dialer-proxy']`；`subconverter-rules` 会把 `chain=` 放进 Shadowrocket 节点 URI，并另外生成代理组。[过滤脚本字段说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)、[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)
- 未知项：官方没有公开声明 Base64 节点 URI 一定解析 `chain=`，也没有公开声明 `$server['dialer-proxy']` 是 URI 参数；因此不能把社区实现的行为承诺为所有 Shadowrocket 版本的兼容保证。[官方配置仓库](https://github.com/Shadowrocket/config)、[subconverter README](https://github.com/tindy2013/subconverter/blob/master/README.md)

## Shadowrocket 的两种相关能力

### 1. 节点链（客户端能力，不等于 URI 标准）

Shadowrocket 的批量过滤脚本可以设置：

```text
$server.chain="订阅名称/节点名称"
$server['dialer-proxy']="节点 UUID"
```

这份社区手册说明 `chain` 可以引用订阅内的节点名、`订阅名称/节点名称` 路径或 UUID；链节点缺失时还可通过 `close-if-proxy-chain-missing` 控制是否关闭连接。它是目前公开可验证的字段记录，但不是官方协议文档。[过滤脚本字段说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

主流 `subconverter-rules` 的 Shadowrocket 适配则把关系编码为节点 URI 的专用查询参数：

```text
<node-uri>?chain=%F0%9F%94%80%20%E4%B8%AD%E8%BD%AC%E4%BB%A3%E7%90%86#节点名
```

该项目的 Worker 源码明确在节点 URI 中追加 `chain=<名称>`，并在独立的 Shadowrocket 配置中定义对应的中转组。[项目 README 的 Shadowrocket 说明](https://github.com/monlor/subconverter-rules)、[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)、[Shadowrocket 配置模板](https://raw.githubusercontent.com/monlor/subconverter-rules/main/shadowrocket/template.conf)

这里的 `chain=` 是 Shadowrocket 的实现扩展，不是 SIP002、VLESS 或 Trojan URI 标准字段。通用 `subconverter` 文档列出的目标主要是 `ss`、`ssr`、`v2ray`、`mixed`，没有定义跨客户端的链式代理 URI 规范。[subconverter README](https://github.com/tindy2013/subconverter/blob/master/README.md)

### 本项目真机验证

2026-08-27 的 Shadowrocket 真机对比确认：`chain` 值中的空格若由 `URLSearchParams` 编码为 `+`，客户端会把加号当作节点名称的一部分，显示为 `🇺🇸 + 美国@c57s3`，因而无法精确匹配 `🇺🇸 美国@c57s3`。改用 URI 百分号编码 `%20` 后，“代理通过”会显示正确的节点名称。因此本项目生成节点 URI 时必须把查询串中的空格编码为 `%20`，不能使用表单编码的 `+`。

## 字段和引用形式结论

| 名称 | 公开证据及适用层级 | 本项目结论 |
| --- | --- | --- |
| `chain` | 社区 Shadowrocket 过滤脚本使用 `$server.chain`；`subconverter-rules` 在 URI 查询串追加 `chain=` | 可作为 Shadowrocket 链属性；URI 形式是社区实现扩展，能作为兼容性尝试，但不是官方标准 |
| `dialer-proxy` | Mihomo/Clash 官方字段表示“通过另一个代理拨号”；社区 Shadowrocket 脚本也示例 `$server['dialer-proxy']` | 继续用于 Clash YAML；若使用 Shadowrocket 过滤脚本可尝试设置该属性，但不要把 `dialer-proxy=` 当作 Shadowrocket 原始 URI 参数输出 |
| `underlying-proxy` | 主流转换器将它作为 Surge 的字段，与 Clash 的 `dialer-proxy`、Shadowrocket 的 `chain` 分开处理 | 没有 Shadowrocket 官方接受证据，不应输出 |
| 引用显示名 | 社区手册描述节点名/路径可引用；同名节点可能有歧义 | 仅在名称唯一且订阅路径稳定时使用；裸显示名不是跨版本最稳的标识 |
| `订阅名称/节点名称` | 社区手册明确列为 `chain` 的引用形式 | 过滤脚本中优先使用完整路径，避免不同订阅的同名节点冲突 |
| UUID | 社区手册说明可用节点 UUID，并可从节点或订阅 JSON 获取 | 自动化时优先 UUID；但需确认上游订阅刷新不会更换 UUID |
| 代理组 | 社区手册说明代理组可作为链的中间节点；转换器另在 `.conf` 中创建中转组 | 组必须已经存在于 Shadowrocket 配置；纯 URI 列表不会创建组 |

上述引用形式来自社区手册和转换器源码；Shadowrocket 官方公开仓库没有对应的字段规范，因此应在目标 App 版本上手工验收。[过滤脚本字段说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)、[转换器 README](https://github.com/monlor/subconverter-rules)、[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)

### 2. `Relay` 协议节点（不要误用）

Shadowrocket 手册中的 `Relay` 是单独的 `GOST (2.11+) Relay` 协议，需要真实的 GOST Relay 服务端；它不等价于“普通 SS 节点通过另一个节点连接”。[Relay 节点说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_tutorial.md#relay)

因此，现有 Clash 的加拿大 SS 节点应继续序列化为 `ss://`，通过 `chain` 或客户端过滤脚本建立链关系，不应伪装成 `Relay` 节点。

## 标准 URI 的限制

现有接口返回的是“换行分隔节点 URI 的 Base64”。这种格式只能携带每个节点自身的协议和参数，不能在同一份 URI 列表中声明 `[Proxy Group]`、`url-test` 或策略规则。`subconverter-rules` 的实现也把 `chain=` 放在节点 URI 中，同时把中转组放在另一个 Shadowrocket `.conf` 模板中，说明“节点列表”和“组定义”是两个配置层级。[节点 URI 生成源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)、[组定义源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/shadowrocket.ts)

所以，单纯给加拿大节点写入 `chain=🪜 链式前置` 只有在 Shadowrocket 中已经存在同名节点或组时才可能生效；纯订阅列表本身不会创建该组。`subconverter-rules` 的可验证实现确实把 `chain=` 放在 Base64 节点订阅中，但同时依赖单独的 `.conf` 组定义；这证明“某些版本/配置下可用”，不能证明所有版本都保证解析。若引用名称不存在，社区手册记录的缺省行为可能跳过链节点而直连，需结合 `close-if-proxy-chain-missing` 验证或显式关闭该回退行为。[链缺失行为及过滤字段](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)、[节点 URI 生成源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)

## 可落地方案

### 方案 A：保持当前 Base64 接口，使用 `chain=` URI 扩展（低改动、需验收）

1. 将加拿大节点输出为普通 `ss://` 节点。
2. 保留原始直连节点。
3. 对每个可转换的原始节点，再生成一个“加拿大中转”变体：目标仍为加拿大 SS 服务端，但在 URI 查询中追加 `chain=<前置节点名、完整路径或 UUID>`，名称使用唯一备注，例如 `加拿大中转@原节点名`。
4. 查询参数必须放在 `#备注` 之前；已有查询参数时使用 `&chain=`，否则使用 `?chain=`，并对名称进行 URL 编码。`subconverter-rules` 的 `addChain()` 正是该拼接方式。[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)

该方案不依赖额外运行时或外部转换服务，且引用的前置节点与加拿大节点可同属一个订阅。它只是社区扩展的兼容性方案：必须确保被引用的节点或代理组已经存在，不能在纯 URI 列表内复现 Clash 的 `url-test` 动态前置组；应在文档中说明用户需要选择“加拿大中转”变体，或预先在 Shadowrocket 中配置同名组。[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)

### 方案 B：当前 Base64 接口配合过滤脚本（最简单的可重复自动化）

若要求每次订阅更新后仍自动设置“代理通过”，最简单的方案是继续输出普通节点，同时让用户在 Shadowrocket 中为该订阅配置一次过滤脚本：按唯一的 `订阅名称/节点名称` 设置 `$server.chain`，或按稳定 UUID 设置 `$server['dialer-proxy']`。脚本由客户端在订阅解析/更新时执行，避免服务端猜测本地显示名；缺点是依赖用户已有的脚本配置，不能由纯 Base64 URI 自包含完成。[过滤脚本字段说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

生产环境应将链缺失策略设为 `close-if-proxy-chain-missing=true`（若目标版本/配置支持），避免找不到前置节点时静默回退直连；这条行为来自社区手册，需在实际版本验证。[链缺失行为](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

### 方案 C：新增 Shadowrocket `.conf` 配置目标

若必须零接触复现“前置节点自动测速/选择”、代理组和规则，应另增明确的配置目标（例如 `target=shadowrocket-config`），输出包含 `[Proxy]` 与 `[Proxy Group]` 的完整 Shadowrocket 配置，并让节点的 `chain` 指向该配置中实际存在的组名。不要把完整 `.conf` 混入现有 Base64 URI 接口，以免破坏当前订阅契约。`subconverter-rules` 的模板与 Worker 分别生成节点和组，已验证此分层方式；这仍是第三方实现先例，不是官方格式规范。[Shadowrocket 模板](https://raw.githubusercontent.com/monlor/subconverter-rules/main/shadowrocket/template.conf)、[组生成实现](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/shadowrocket.ts)

### 方案 D：手工配置

短期可让用户导入普通节点订阅后，在节点详情页选择“代理通过”。这适合验证链路，但依赖用户本地配置，订阅刷新时的可重复性和自动化较差。[脚本字段](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

## 对本项目的建议

首版不要输出 Shadowrocket `Relay` 协议；加拿大节点仍应作为普通 SS 节点输出。若只维持现有 Base64 接口，优先采用方案 B 的一次性过滤脚本：用完整订阅路径或 UUID 设置链，兼容性和行为边界比把关系硬塞进 URI 更清楚。方案 A 的 `chain=` 可作为低改动的兼容性尝试，但必须把“需要已有节点/组、未获官方 URI 契约保证”写入文档。若产品要求零接触、动态测速或完整复现 Clash 的 `🪜 链式前置` 组，再单独设计方案 C，并提供完整 `.conf` 订阅和最新版 Shadowrocket 的手工验收。
