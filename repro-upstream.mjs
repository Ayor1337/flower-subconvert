import assert from "node:assert/strict";
const service = process.env.JMS_SERVICE;
const id = process.env.JMS_ID;
const password = process.env.JMS_RELAY_PASSWORD;

assert.ok(service && id && password, "请设置 JMS_SERVICE、JMS_ID、JMS_RELAY_PASSWORD");

const workerModule = await import(new URL(`./worker.js?repro=${Date.now()}`, import.meta.url));
const worker = workerModule.default;
const networkFetch = globalThis.fetch;
let upstreamMeta = null;

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === "jmssub.net") {
    try {
      const response = await networkFetch(input, init);
      const sample = await response.clone().text();
      const compact = sample.trim().replace(/\s+/g, "");
      const looksBase64 = compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
      let decodedMeta = null;
      if (looksBase64) {
        const decoded = Buffer.from(compact, "base64").toString("utf8");
        const schemes = {};
        const uriShapes = [];
        for (const line of decoded.split(/\r?\n/)) {
          const scheme = line.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
          if (scheme) {
            schemes[scheme] = (schemes[scheme] || 0) + 1;
            const parsed = new URL(line);
            uriShapes.push({
              scheme,
              hasUsername: Boolean(parsed.username),
              hasPassword: Boolean(parsed.password),
              hasHost: Boolean(parsed.hostname),
              hasPort: Boolean(parsed.port),
              queryKeys: [...parsed.searchParams.keys()].sort(),
              nodeCode: decodeURIComponent(parsed.hash).match(/c57s\d+/i)?.[0] || "unknown",
            });
          }
        }
        decodedMeta = {
          bytes: Buffer.byteLength(decoded),
          lines: decoded.split(/\r?\n/).filter(Boolean).length,
          schemes,
          uriShapes,
          hasProxiesKey: /^proxies:/m.test(decoded),
        };
      }
      upstreamMeta = {
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(sample),
        startsWithHtml: /^\s*</.test(sample),
        hasProxiesKey: /^proxies:/m.test(sample),
        looksBase64,
        decodedMeta,
      };
      return response;
    } catch (error) {
      upstreamMeta = {
        networkError: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error
          ? error.message.replace(/https?:\/\/\S+/g, "<REDACTED>")
          : "unknown",
        causeCode: error?.cause?.code || null,
      };
      throw error;
    }
  }
  if (url.hostname === "justmysocks6.net") {
    return networkFetch(input, init);
  }
  throw new Error("检测到非预期的上游主机");
};

try {
  const requestUrl = new URL("https://flower-sub.test/sub");
  const token = Buffer.from(`${service}|${id}|${password}`, "utf8").toString("base64");
  requestUrl.searchParams.set("token", token);

  const response = await worker.fetch(new Request(requestUrl));
  const body = await response.text();

  assert.equal(
    response.status,
    200,
    `RED: 动态订阅返回 ${response.status} ${body.slice(0, 200)}；上游元数据=${JSON.stringify(upstreamMeta)}`,
  );
  assert.match(body, /^mixed-port: 7890/m);
  assert.match(body, /^proxies:/m);
  assert.equal(
    response.headers.get("content-disposition"),
    "attachment; filename*=UTF-8''JustMySocks",
  );
  const subscriptionInfo = response.headers.get("subscription-userinfo");
  assert.match(subscriptionInfo, /; expire=\d+$/);
  const expire = Number(subscriptionInfo.match(/expire=(\d+)/)[1]);
  assert.equal(new Date(expire * 1000).getUTCDate(), 18);
  console.log("GREEN: 实时上游可以转换为 Clash YAML（响应内容已隐藏）");
} finally {
  globalThis.fetch = networkFetch;
}
