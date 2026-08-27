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

部署到 Cloudflare Workers 后，网站根路径 `/` 由 React 前端提供，`/sub` 与 `/sub/*` 会优先进入 Worker。新的订阅链接使用 10 位短 token，旧的 Base64 token 仍兼容。

短 token 存放在名为 `TOKENS` 的 Cloudflare KV binding 中：

- KV key：10 位 URL-safe token，例如 `aZ8Kp2Qx_7`
- KV value：`{"service":"...","id":"...","password":"..."}`

其中 `password` 是加拿大 Relay 密码。凭据只应写入 Cloudflare KV，不要提交到 GitHub。

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

## Cloudflare Workers 部署

项目已包含 `wrangler.jsonc`，用于把 Worker 和 Vite 静态资源一起部署。

在 Cloudflare Workers 的 Git 部署设置中使用：

- 构建命令：`npm run build`
- 部署命令：`npx wrangler deploy`
- 根目录：仓库根目录

部署时请继续将现有自定义域名绑定到该 Worker。也可以在本地执行：

```bash
npm run deploy
```

## 检查

```bash
npm run test:worker
npm run build
```
