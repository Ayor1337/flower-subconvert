# `/sub` 请求防护运维说明

生产订阅入口为 `https://floweeersub.lat/sub`。订阅接口只接受 `GET` 和 `HEAD`，并使用 Cloudflare KV 中存在的 10 位 URL-safe token 鉴权。IP 历史接口位于 `/sub/history`，只接受 `GET` 和 `Authorization: Bearer <token>`，不得把 TOKEN 放入查询串。

## Cloudflare 规则

规则通过 Cloudflare Rulesets API 部署。更新规则时按固定 `ref` 查找并替换目标规则，必须保留同一 phase 中的其他规则。

### 方法拦截

- phase：`http_request_firewall_custom`
- ref：`flower_sub_method_guard`
- action：`block`
- expression：

```text
(http.host eq "floweeersub.lat" and ((http.request.uri.path eq "/sub" and not http.request.method in {"GET" "HEAD"}) or (http.request.uri.path eq "/sub/history" and http.request.method ne "GET")))
```

### IP 限流

- phase：`http_ratelimit`
- ref：`flower_sub_rate_limit`
- action：`block`
- expression：

```text
(http.host eq "floweeersub.lat" and http.request.uri.path in {"/sub" "/sub/history"})
```

- characteristics：`cf.colo.id`、`ip.src`
- requests per period：`10`
- period：`10` 秒
- mitigation timeout：`10` 秒
- requests to origin：`false`，所有匹配请求都计数

Cloudflare Free 套餐只提供有限的统计维度、周期和动作。不要把动作改成 Turnstile、Managed Challenge，也不要对整个域名开启 Bot Fight Mode；Clash、Mihomo、Stash 和 Shadowrocket 无法完成浏览器挑战。

## 验证

1. 回读两个 phase 的 entrypoint ruleset，确认上述 `ref` 唯一、规则启用且参数一致。
2. 使用一个现有短 token 分别刷新 Clash 和 Shadowrocket，确认返回 `200`；验证过程不得输出完整 URL 或 token。
3. 使用同一 TOKEN 通过 Authorization Bearer 查询 `/sub/history`，确认新记录包含 IP、时间、方法和状态码；不得输出完整 TOKEN。
4. 不带 Authorization、只带 `?token=`、使用错误 TOKEN 分别查询 `/sub/history`，确认都返回与未知路由一致的 `404`。
5. 对 `/sub` 和 `/sub/history` 发送不允许的方法，确认请求在边缘被拦截。
6. 连续发送 11 个不带 token 的 `/sub` 或 `/sub/history` 请求，确认第 11 个请求触发限流；10 秒后确认接口恢复。
7. 确认 `HISTORY_DB` 已绑定、D1 migration 已应用、每小时清理 trigger 已部署，并确认 Worker 的 `workers.dev` 和 Preview URL 均为关闭状态。

Cloudflare 的限流计数在边缘数据中心传播，验证时可能有少量超额请求通过，不能把规则当作严格并发控制器。

## 回滚与 token 轮换

- 误伤正常订阅时，先按固定 `ref` 禁用 `flower_sub_rate_limit`，不要删除或覆盖 phase 中的其他规则。
- 方法规则误伤时，以相同方式禁用 `flower_sub_method_guard`。
- Worker 回归时回滚到上一个稳定版本，但保留边缘限流规则；旧版本会重新开放 Base64 token，只能作为短时应急措施。
- 历史功能回归时可回滚 Worker；不要删除 D1，历史写入本身失败不会影响订阅。确认稳定后再决定是否移除 binding 和定时任务。
- token 泄露时删除对应 KV key，生成新的 10 位 token 和 KV 记录，再更新所有客户端。旧 TOKEN 的历史会立即无法通过接口查询，并在 72 小时保留期结束后清理。不要在日志、监控、提交信息或聊天中粘贴完整订阅 URL 或 Authorization 请求头。
