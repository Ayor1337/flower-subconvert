export function helpResponse(isHead) {
  const body = [
    "flower-sub 动态订阅服务",
    "",
    "GET /sub?token=<10 位短 token>",
    "GET /sub?token=<10 位短 token>&target=clash",
    "GET /sub?token=<10 位短 token>&target=shadowrocket",
    "",
    "显式 target 优先；省略 target 时根据 User-Agent 自动识别客户端。",
    "Shadowrocket 返回节点订阅；Clash、Mihomo、Stash 和未知客户端返回 Clash YAML。",
    "短 token 由 Cloudflare KV 映射到订阅凭据，请将完整订阅 URL 视为敏感信息。",
  ].join("\n");

  return new Response(isHead ? null : body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(status, message, isHead, extraHeaders = {}) {
  return new Response(isHead ? null : JSON.stringify({ error: message }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
