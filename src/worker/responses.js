export function helpResponse(isHead) {
  const body = [
    "flower-sub 动态订阅服务",
    "",
    "GET /sub?token=<10 位短 token>",
    "GET /sub?token=<10 位短 token>&target=shadowrocket",
    "",
    "省略 target 或使用 target=clash 时返回 Clash YAML；target=shadowrocket 返回节点订阅。",
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
