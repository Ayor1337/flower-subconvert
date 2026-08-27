export function helpResponse(isHead) {
  const body = [
    "flower-sub 动态订阅服务",
    "",
    "GET /sub?token=<Base64(UTF-8(service|id|加拿大Relay密码))>",
    "",
    "请对每个参数进行 URL 编码，并将完整订阅 URL 视为敏感信息。",
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
