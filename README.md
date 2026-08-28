# flower-sub

Vite 8 + React 前端与 Cloudflare Module Worker 的订阅转换服务。

## 开发命令

```bash
npm install
npm run dev
```

## Worker

根目录的 `worker.js` 是部署入口，实际实现位于 `src/worker/`。原有 Worker 服务保持不变：

- `GET|HEAD /sub?token=...`：获取并转换上游订阅。
- `GET|HEAD /sub?token=...&target=clash`：强制获取 Clash YAML。
- `GET|HEAD /sub?token=...&target=shadowrocket`：获取 Shadowrocket Base64 节点订阅。

显式 `target` 的优先级高于客户端 `User-Agent`。省略或留空 `target` 时，Worker 会自动识别客户端：UA 包含 `Shadowrocket` 时返回 Shadowrocket 节点订阅；包含 `Clash`、`Mihomo` 或 `Stash` 时返回 Clash YAML。空 UA、浏览器和其他未知客户端仍返回 Clash YAML，以兼容原有订阅链接。参数和 UA 匹配均不区分大小写。

部署到 Cloudflare Workers 后，网站根路径 `/` 由 React 前端提供，`/sub` 与 `/sub/*` 会优先进入 Worker。订阅链接只接受 Cloudflare KV 中存在的 10 位 URL-safe 短 token；旧的 Base64 token 已停止支持。

短 token 存放在名为 `TOKENS` 的 Cloudflare KV binding 中：

- KV key：10 位 URL-safe token，例如 `aZ8Kp2Qx_7`
- KV value：`{"service":"...","id":"...","password":"..."}`

其中 `password` 是加拿大 Relay 密码。凭据只应写入 Cloudflare KV，不要提交到 GitHub。完整订阅 URL 是 bearer credential，不得写入日志、截图或工单；怀疑泄露时应删除对应 KV key 并生成新 token。

### 订阅 IP 历史

TOKEN 鉴权成功后的每次 `GET|HEAD /sub` 都会把请求 IP、请求时间、方法和最终 HTTP 状态码异步写入 D1，包括上游或转换失败的请求。历史写入失败不会中断订阅，缺少或无效 TOKEN 的请求不会记录。记录只保留 72 小时。

历史接口不接受查询串 TOKEN，只接受 `Authorization` 请求头：

```bash
curl -H "Authorization: Bearer <短 token>" \
  "https://你的域名/sub/history?limit=100"
```

成功响应按时间倒序返回：

```json
{
  "data": {
    "items": [
      {
        "ip": "203.0.113.10",
        "requestedAt": "2026-08-28T04:00:00.000Z",
        "method": "GET",
        "statusCode": 200,
        "success": true
      }
    ],
    "nextCursor": null
  }
}
```

`limit` 默认 100，范围为 1–500。有下一页时，把响应中的不透明 `nextCursor` 原样作为 `cursor` 查询参数传回。缺少或使用错误 TOKEN 时接口统一返回 `404`。主页也提供手动查询区，TOKEN 仅保存在当前 React 组件内存中，并通过 Authorization 请求头发送；不会写入 URL 或 localStorage，刷新或清除后即消失。

可以用 Node.js 生成一个 10 位随机 token：

```bash
node -e "const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';const b=new Uint8Array(10);crypto.getRandomValues(b);console.log([...b].map(x=>a[x%64]).join(''))"
```

如果使用 Wrangler CLI 部署，请把 Cloudflare 控制台生成的 `kv_namespaces` 配置片段加入 `wrangler.jsonc`，其中 binding 必须是 `TOKENS`；仅在控制台绑定时则确保该 binding 已部署到生产环境。

固定的 Clash 策略组配置来自 `clash-policy.yaml`。修改该文件后运行：

```bash
npm run build:worker
```

该命令只更新 `src/worker/config.generated.js`，不会覆盖 Worker 入口或业务模块。`npm run build` 也会自动执行这一步，然后构建 React 前端。

本地上游订阅快照请不要提交。仓库已忽略其他 YAML 文件，避免把节点密码、UUID 等敏感信息上传到公开仓库。

## Shadowrocket

在 Shadowrocket 中新增 `Subscribe`，将原有订阅 URL 加上 `target=shadowrocket`：

```text
https://你的域名/sub?token=<短 token>&target=shadowrocket
```

返回内容是 Base64 编码的节点 URI 列表，只包含节点，不包含 Clash 的策略组、规则和 DNS。当 `🇺🇸 美国@c57s3` 可转换时，订阅会同时包含 `🇨🇦 加拿大@relay`，供 Shadowrocket 配置“代理通过”。首版兼容范围如下：

| 协议 | TCP | WebSocket | TLS/SNI | 备注 |
| --- | --- | --- | --- | --- |
| Shadowsocks | 是 | 通过 `v2ray-plugin` | 由插件参数决定 | 支持 SIP002、simple-obfs |
| VMess | 是 | 是 | 是 | 输出 Shadowrocket 兼容的 Base64 JSON URI |
| VLESS | 是 | 是 | 是 | 支持 TCP Reality，保留 SNI、指纹、公钥和短 ID |
| Trojan | 是 | 是 | 是 | TLS 默认启用 |

gRPC、HTTP/2、XHTTP、非 TCP Reality 和其他未覆盖传输会被跳过。成功响应的 `X-Subscription-Skipped` 头表示跳过数量；如果没有任何可转换节点，接口返回 `422`。

加拿大节点的 URI 会携带 Shadowrocket 专用参数 `chain=🇺🇸 美国@c57s3`，因此导入后默认通过 c57s3 连接。该参数是 Shadowrocket 扩展，不属于通用 SIP002 标准。

如果所用 Shadowrocket 版本没有应用 URI 中的 `chain`，可在该订阅的 `ⓘ → 过滤` 中加入以下兼容脚本：

```javascript
if (/加拿大@relay/.test($server.title)) {
  $server.chain = "🇺🇸 美国@c57s3";
}
```

建议同时在当前配置的 `[General]` 段加入 `close-if-proxy-chain-missing = true`，防止 c57s3 丢失时绕过链路直连加拿大节点。

### Shadowrocket (English)

Create a `Subscribe` entry in Shadowrocket and append `target=shadowrocket` to the existing URL. The response is a Base64-encoded list of SS, VMess, VLESS, and Trojan node URIs. TCP and WebSocket transports are supported, including TLS/SNI and WebSocket Host/Path. VLESS over TCP with Reality is supported and preserves SNI, fingerprint, public key, short ID, and optional SpiderX parameters. When c57s3 is available, the feed also includes the Canada relay with Shadowrocket's non-standard `chain=🇺🇸 美国@c57s3` URI parameter. The filter script above is a fallback for versions that do not apply this URI extension. Clash policy groups, rules, DNS settings, gRPC, HTTP/2, XHTTP, and non-TCP Reality transports are not included. Unsupported nodes are counted in the `X-Subscription-Skipped` response header; the endpoint returns `422` when no node can be converted.

## Cloudflare Workers 部署

项目已包含 `wrangler.jsonc`，用于把 Worker 和 Vite 静态资源一起部署。

在 Cloudflare Workers 的 Git 部署设置中使用：

- 构建命令：`npm run build`
- 部署命令：`npx wrangler deploy`
- 根目录：仓库根目录

首次启用历史记录时，先创建 D1 并把命令返回的 `database_id` 加入 `wrangler.jsonc` 的 `HISTORY_DB` 配置，再应用迁移：

```bash
npx wrangler d1 create flower-sub-history
npx wrangler d1 migrations apply flower-sub-history --remote
```

当前配置省略 `database_id`，Wrangler 4.45+ 部署时也可以自动创建 D1 并回写 ID；这种方式首次部署后仍需立即执行上面的远程迁移。生产环境建议显式创建、先迁移再部署，避免历史接口在表创建前短暂返回 `503`。

部署时请继续将现有自定义域名绑定到该 Worker。也可以在本地执行：

```bash
npm run deploy
```

生产环境仅使用自定义域名，`workers.dev` 与 Preview URL 已在 `wrangler.jsonc` 中关闭。`/sub` 和 `/sub/history` 的 WAF、限流、验证及回滚步骤见 [请求防护运维说明](doc/request-protection.md)。

## 检查

```bash
npm run test:worker
npm run build
```
