# Shadowrocket 链式代理适配调研

调研日期：2026-08-27

## 结论摘要

当前 Clash 配置中的加拿大节点是一个普通 SS 节点，靠 `dialer-proxy: "🪜 链式前置"` 指定其出站连接经过前置节点；它不是 Shadowrocket 的 `Relay`（GOST Relay）协议节点。Mihomo 文档将 `dialer-proxy` 定义为“通过另一个代理拨号”，并说明旧的 `relay` 策略已弃用，建议使用该字段。[Mihomo `dialer-proxy` 文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxies/dialer-proxy.en.md)、[Mihomo `relay` 文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/proxy-groups/relay.en.md)

Shadowrocket 可以表达相同关系：节点 A 的连接“通过”节点 B，流量顺序为 `Client > B > A > Web server`，并支持多级链和代理组作为中间节点。[Shadowrocket 使用手册（基于官方文档整理）](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

## Shadowrocket 的两种相关能力

### 1. 节点链（推荐用于本项目）

Shadowrocket 的批量过滤脚本可以设置：

```text
$server.chain="订阅名称/节点名称"
$server['dialer-proxy']="节点 UUID"
```

文档说明 `chain` 可以引用订阅内的节点名、路径或 UUID；链节点缺失时还可通过 `close-if-proxy-chain-missing` 控制是否关闭连接。[过滤脚本字段说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

主流 `subconverter-rules` 的 Shadowrocket 适配则把关系编码为节点 URI 的专用查询参数：

```text
<node-uri>?chain=%F0%9F%94%80%20%E4%B8%AD%E8%BD%AC%E4%BB%A3%E7%90%86#节点名
```

该项目的 Worker 源码明确在节点 URI 中追加 `chain=<名称>`，并在独立的 Shadowrocket 配置中定义对应的中转组。[项目 README 的 Shadowrocket 说明](https://github.com/monlor/subconverter-rules)、[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)、[Shadowrocket 配置模板](https://raw.githubusercontent.com/monlor/subconverter-rules/main/shadowrocket/template.conf)

这里的 `chain=` 是 Shadowrocket 的实现扩展，不是 SIP002、VLESS 或 Trojan URI 标准字段。通用 `subconverter` 文档列出的 Shadowrocket 目标主要是 `ss`、`ssr`、`v2ray`、`mixed`，没有定义跨客户端的链式代理 URI 规范。[subconverter README](https://github.com/tindy2013/subconverter/blob/master/README.md)

### 2. `Relay` 协议节点（不要误用）

Shadowrocket 手册中的 `Relay` 是单独的 `GOST (2.11+) Relay` 协议，需要真实的 GOST Relay 服务端；它不等价于“普通 SS 节点通过另一个节点连接”。[Relay 节点说明](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_tutorial.md#relay)

因此，现有 Clash 的加拿大 SS 节点应继续序列化为 `ss://`，通过 `chain` 或客户端过滤脚本建立链关系，不应伪装成 `Relay` 节点。

## 标准 URI 的限制

现有接口返回的是“换行分隔节点 URI 的 Base64”。这种格式只能携带每个节点自身的协议和参数，不能在同一份 URI 列表中声明 `[Proxy Group]`、`url-test` 或策略规则。`subconverter-rules` 的实现也把 `chain=` 放在节点 URI 中，同时把中转组放在另一个 Shadowrocket `.conf` 模板中，说明“节点列表”和“组定义”是两个配置层级。[节点 URI 生成源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)、[组定义源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/shadowrocket.ts)

所以，单纯给加拿大节点写入 `chain=🪜 链式前置` 只有在 Shadowrocket 中已经存在同名节点或组时才可靠；纯订阅列表本身不会创建该组。若引用名称不存在，Shadowrocket 的缺省行为可能跳过链节点而直连，需结合 `close-if-proxy-chain-missing` 验证或显式关闭该回退行为。[链缺失行为及过滤字段](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

## 可落地方案

### 方案 A：保持当前 Base64 接口，生成链式变体（推荐首版）

1. 将加拿大节点输出为普通 `ss://` 节点。
2. 保留原始直连节点。
3. 对每个可转换的原始节点，再生成一个“加拿大中转”变体：目标仍为加拿大 SS 服务端，但在 URI 查询中追加 `chain=<前置节点名或 UUID>`，名称使用唯一备注，例如 `加拿大中转@原节点名`。
4. 查询参数必须放在 `#备注` 之前；已有查询参数时使用 `&chain=`，否则使用 `?chain=`，并对名称进行 URL 编码。`subconverter-rules` 的 `addChain()` 正是该拼接方式。[`addChain()` 源码](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/sub.ts)

该方案不依赖额外运行时或外部转换服务，且引用的前置节点与加拿大节点可同属一个订阅。代价是节点数量增加，不能在纯 URI 列表内复现 Clash 的 `url-test` 动态前置组；应在文档中说明用户需要选择“加拿大中转”变体，或预先在 Shadowrocket 中配置同名组。

### 方案 B：新增 Shadowrocket `.conf` 配置目标

若必须复现“前置节点自动测速/选择”、代理组和规则，应另增明确的配置目标（例如 `target=shadowrocket-config`），输出包含 `[Proxy]` 与 `[Proxy Group]` 的完整 Shadowrocket 配置，并让节点的 `chain` 指向该配置中实际存在的组名。不要把完整 `.conf` 混入现有 Base64 URI 接口，以免破坏当前订阅契约。`subconverter-rules` 的模板与 Worker 分别生成节点和组，已验证此分层方式。[Shadowrocket 模板](https://raw.githubusercontent.com/monlor/subconverter-rules/main/shadowrocket/template.conf)、[组生成实现](https://raw.githubusercontent.com/monlor/subconverter-rules/main/worker/src/shadowrocket.ts)

### 方案 C：过滤脚本/手工配置

短期可让用户导入普通节点订阅后，在 Shadowrocket 的订阅过滤脚本中设置 `$server.chain`，或在节点详情页选择“代理通过”。这适合验证链路，但依赖用户本地配置，订阅刷新时的可重复性和自动化较差。[脚本字段](https://github.com/free-nodes/shadowrocket/blob/main/docs/shadowrocket_manual.md#%E4%BB%A3%E7%90%86%E9%93%BE)

## 对本项目的建议

首版应采用方案 A：把加拿大节点作为普通 SS 节点输出，并为需要链路的节点生成带 Shadowrocket `chain=` 扩展参数的变体；不要输出 Shadowrocket `Relay` 协议。若产品要求继续保留 Clash 中 `🪜 链式前置` 的测速/策略组语义，再单独设计方案 B，并提供完整 `.conf` 订阅和最新版 Shadowrocket 的手工验收。
