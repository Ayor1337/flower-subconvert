import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONFIG_HEAD, FIXED_TAIL } from "./src/worker/config.generated.js";
import { hashToken } from "./src/worker/history.js";
import { buildRelayNode } from "./src/worker/relay.js";
import { serializeShadowrocketProxy } from "./src/worker/shadowrocket.js";

const workerModule = await import(new URL(`./worker.js?test=${Date.now()}`, import.meta.url));
const deployedWorker = workerModule.default;
const sourceYaml = await readFile(
  new URL("./test/fixtures/subscription.txt", import.meta.url),
  "utf8",
);
const expectedProxyBlock = sourceYaml
  .replace(/^proxies:\n/, "")
  .replace('name: "🇺🇸 美国@c57s801"', 'name: "🇺🇸 美国@c57s801 [0.1x下载路线]"')
  .trimEnd();
const defaultService = "1234567";
const defaultId = "11111111-2222-3333-4444-555555555555";
const defaultPassword = "fixture-relay-password";
const defaultShortToken = "aZ8Kp2Qx_7";
const tokenStore = new Map([
  [
    defaultShortToken,
    JSON.stringify({
      service: defaultService,
      id: defaultId,
      password: defaultPassword,
    }),
  ],
]);
class HistoryDatabase {
  constructor() {
    this.events = [];
    this.nextId = 1;
    this.failReads = false;
    this.failWrites = false;
    this.readCount = 0;
  }

  prepare(sql) {
    return {
      bind: (...values) => ({
        all: async () => this.#all(sql, values),
        run: async () => this.#run(sql, values),
      }),
    };
  }

  reset() {
    this.events = [];
    this.nextId = 1;
    this.failReads = false;
    this.failWrites = false;
    this.readCount = 0;
  }

  async #all(sql, values) {
    if (this.failReads) throw new Error("D1 read unavailable");
    if (!sql.includes("SELECT id, ip, requested_at, method, status_code")) {
      throw new Error(`Unexpected D1 query: ${sql}`);
    }
    this.readCount += 1;

    const [tokenHash, cutoff] = values;
    const hasCursor = sql.includes("id < ?4");
    const cursorTime = hasCursor ? values[2] : null;
    const cursorId = hasCursor ? values[3] : null;
    const limit = values[values.length - 1];
    const results = this.events
      .filter((event) => event.token_hash === tokenHash && event.requested_at >= cutoff)
      .filter((event) => !hasCursor ||
        event.requested_at < cursorTime ||
        (event.requested_at === cursorTime && event.id < cursorId))
      .sort((left, right) =>
        right.requested_at - left.requested_at || right.id - left.id
      )
      .slice(0, limit)
      .map((event) => ({ ...event }));
    return { results, success: true };
  }

  async #run(sql, values) {
    if (sql.includes("INSERT INTO subscription_ip_events")) {
      if (this.failWrites) throw new Error("D1 write unavailable");
      const [tokenHash, ip, requestedAt, method, statusCode] = values;
      this.events.push({
        id: this.nextId++,
        ip,
        method,
        requested_at: requestedAt,
        status_code: statusCode,
        token_hash: tokenHash,
      });
      return { success: true };
    }
    if (sql.includes("DELETE FROM subscription_ip_events")) {
      if (this.failWrites) throw new Error("D1 write unavailable");
      const [cutoff] = values;
      this.events = this.events.filter((event) => event.requested_at >= cutoff);
      return { success: true };
    }
    throw new Error(`Unexpected D1 statement: ${sql}`);
  }
}

const historyDb = new HistoryDatabase();
const pendingTasks = [];
const executionContext = {
  waitUntil(task) {
    pendingTasks.push(task);
  },
};
const workerEnv = {
  HISTORY_DB: historyDb,
  TOKENS: {
    async get(key) {
      return tokenStore.get(key) ?? null;
    },
  },
};
const worker = {
  fetch(request, env = workerEnv, context = executionContext) {
    return deployedWorker.fetch(request, env, context);
  },
};
const expectedYaml =
  CONFIG_HEAD +
  buildRelayNode(defaultPassword) +
  "\n" +
  expectedProxyBlock +
  "\n\n" +
  FIXED_TAIL +
  "\n";

const realFetch = globalThis.fetch;
const realDate = globalThis.Date;
let upstreamFetchCount = 0;
let tokenSequence = 0;

function installFetchMock({
  bandwidthOk = true,
  resetDay = 18,
  subscriptionBody = sourceYaml,
  subscriptionOk = true,
} = {}) {
  upstreamFetchCount = 0;
  globalThis.fetch = async (input) => {
    upstreamFetchCount += 1;
    const url = String(input);
    if (url.startsWith("https://jmssub.net/members/getsub.php")) {
      return subscriptionOk
        ? new Response(subscriptionBody, { status: 200 })
        : new Response("upstream error", { status: 503 });
    }
    if (url.startsWith("https://justmysocks6.net/members/getbwcounter.php")) {
      return bandwidthOk
        ? Response.json({
            monthly_bw_limit_b: 500000000000,
            bw_counter_b: 62665088049,
            bw_reset_day_of_month: resetDay,
          })
        : new Response("upstream error", { status: 503 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function subscriptionRequest(params = {}) {
  const url = new URL("https://flower-sub.example/sub");
  const service = params.service ?? defaultService;
  const id = params.id ?? defaultId;
  const password = params.password ?? defaultPassword;
  let token = params.token;
  if (token === undefined) {
    const usesDefaultCredentials = service === defaultService &&
      id === defaultId &&
      password === defaultPassword;
    token = usesDefaultCredentials
      ? defaultShortToken
      : `T${String(++tokenSequence).padStart(9, "0")}`;
    tokenStore.set(token, JSON.stringify({ service, id, password }));
  }
  url.searchParams.set("token", token);
  if (params.target !== undefined) url.searchParams.set("target", params.target);
  const headers = new Headers();
  if (params.ip !== null) {
    headers.set("CF-Connecting-IP", params.ip || "203.0.113.10");
  }
  if (params.userAgent !== undefined) {
    headers.set("User-Agent", params.userAgent);
  }
  return new Request(url, { headers, method: params.method || "GET" });
}

function historyRequest({
  cursor,
  limit,
  method = "GET",
  queryToken,
  token = defaultShortToken,
} = {}) {
  const url = new URL("https://flower-sub.example/sub/history");
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  if (limit !== undefined) url.searchParams.set("limit", limit);
  if (queryToken !== undefined) url.searchParams.set("token", queryToken);
  const headers = token === null
    ? undefined
    : { Authorization: `Bearer ${token}` };
  return new Request(url, { headers, method });
}

async function flushBackgroundTasks() {
  while (pendingTasks.length) {
    await Promise.all(pendingTasks.splice(0));
  }
}

try {
  installFetchMock();
  const success = await worker.fetch(subscriptionRequest());
  assert.equal(success.status, 200);
  assert.equal(
    success.headers.get("content-disposition"),
    "attachment; filename*=UTF-8''JustMySocks",
  );
  const subscriptionInfo = success.headers.get("subscription-userinfo");
  // 上游字节经 2^30/10^9 放大：500e9 → 536870912000，62665088049 → 67286125943
  assert.match(
    subscriptionInfo,
    /^upload=0; download=67286125943; total=536870912000; expire=\d+$/,
  );
  const expire = Number(subscriptionInfo.match(/expire=(\d+)/)[1]);
  const expireDate = new Date(expire * 1000);
  assert.ok(expire * 1000 > Date.now());
  assert.equal(expireDate.getUTCDate(), 18);
  assert.equal(success.headers.get("x-subscription-reset-day"), "18");
  assert.equal(await success.text(), expectedYaml);

  installFetchMock();
  const explicitClash = await worker.fetch(subscriptionRequest({ target: "ClAsH" }));
  assert.equal(explicitClash.status, 200);
  assert.equal(explicitClash.headers.get("content-type"), "text/yaml; charset=utf-8");
  assert.equal(await explicitClash.text(), expectedYaml);

  for (const userAgent of [
    "ClashMeta/1.19.0",
    "Mihomo/1.19.0",
    "Stash/2.6.0",
    "Mozilla/5.0",
    "UnknownClient/1.0",
    "",
  ]) {
    installFetchMock();
    const detectedClash = await worker.fetch(subscriptionRequest({ userAgent }));
    assert.equal(detectedClash.status, 200);
    assert.equal(detectedClash.headers.get("content-type"), "text/yaml; charset=utf-8");
    assert.equal(await detectedClash.text(), expectedYaml);
  }

  const unsupportedTarget = await worker.fetch(subscriptionRequest({ target: "surge" }));
  assert.equal(unsupportedTarget.status, 400);

  const shadowrocketYaml = `proxies:
  - name: "JMS-100@c57s1.example:10001"
    type: ss
    server: "2001:db8::1"
    port: 10001
    cipher: "aes-256-gcm"
    password: "a+b/=quoted"
    plugin: obfs
    plugin-opts:
      mode: http
      host: "cdn.example.com"
  - name: "JMS-100@c57s2.example:443"
    type: vmess
    server: "192.0.2.2"
    port: 443
    uuid: "11111111-2222-3333-4444-555555555555"
    alterId: 0
    cipher: auto
    network: ws
    tls: true
    servername: "origin.example.com"
    ws-opts:
      path: "/vmess 路径"
      headers:
        Host: "origin.example.com"
  - name: "JMS-100@c57s3.example:443"
    type: vless
    server: "192.0.2.3"
    port: 443
    uuid: "11111111-2222-3333-4444-555555555555"
    encryption: none
    flow: xtls-rprx-vision
    network: tcp
    tls: true
    servername: "vless.example.com"
    client-fingerprint: chrome
    skip-cert-verify: true
    reality-opts:
      public-key: "test-yaml-public-key"
      short-id: "0123456789abcdef"
      spider-x: "/reality path"
  - name: "JMS-100@c57s4.example:443"
    type: trojan
    server: "192.0.2.4"
    port: 443
    password: "trojan@password"
    network: ws
    servername: "trojan.example.com"
    skip-cert-verify: true
    ws-opts:
      path: "/trojan"
      headers:
        Host: "trojan.example.com"
  - name: "JMS-100@c57s5.example:1080"
    type: socks5
    server: "192.0.2.5"
    port: 1080
  - name: "JMS-100@c57s801.example:443"
    type: vmess
    server: "192.0.2.6"
    port: 443
    uuid: "11111111-2222-3333-4444-555555555555"
    network: grpc
`;
  installFetchMock({ subscriptionBody: shadowrocketYaml });
  const shadowrocket = await worker.fetch(subscriptionRequest({
    target: "ShAdOwRoCkEt",
    userAgent: "ClashMeta/1.19.0",
  }));
  assert.equal(shadowrocket.status, 200);
  assert.equal(shadowrocket.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(shadowrocket.headers.get("x-subscription-skipped"), "2");
  assert.match(shadowrocket.headers.get("content-disposition"), /JustMySocks\.txt/);
  const shadowrocketLinks = Buffer.from(await shadowrocket.text(), "base64").toString("utf8").split("\n");
  assert.equal(shadowrocketLinks.length, 5);

  const ssLink = shadowrocketLinks.find((link) => link.startsWith("ss://"));
  assert.match(ssLink, /@\[2001:db8::1\]:10001\/\?plugin=/);
  const ssUserInfo = ssLink.slice(5, ssLink.indexOf("@"));
  assert.equal(Buffer.from(ssUserInfo.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(), "aes-256-gcm:a+b/=quoted");
  assert.match(decodeURIComponent(new URL(ssLink).searchParams.get("plugin")), /simple-obfs;obfs=http;obfs-host=cdn\.example\.com/);

  const vmessLink = shadowrocketLinks.find((link) => link.startsWith("vmess://"));
  const vmessConfig = JSON.parse(Buffer.from(vmessLink.slice(8), "base64").toString("utf8"));
  assert.equal(vmessConfig.add, "192.0.2.2");
  assert.equal(vmessConfig.sni, "origin.example.com");
  assert.equal(vmessConfig.host, "origin.example.com");
  assert.equal(vmessConfig.path, "/vmess 路径");

  const vlessLink = new URL(shadowrocketLinks.find((link) => link.startsWith("vless://")));
  assert.equal(vlessLink.hostname, "192.0.2.3");
  assert.equal(vlessLink.searchParams.get("security"), "reality");
  assert.equal(vlessLink.searchParams.get("sni"), "vless.example.com");
  assert.equal(vlessLink.searchParams.get("flow"), "xtls-rprx-vision");
  assert.equal(vlessLink.searchParams.get("fp"), "chrome");
  assert.equal(vlessLink.searchParams.get("pbk"), "test-yaml-public-key");
  assert.equal(vlessLink.searchParams.get("sid"), "0123456789abcdef");
  assert.equal(vlessLink.searchParams.get("spx"), "/reality path");
  assert.equal(vlessLink.searchParams.get("allowInsecure"), null);

  const trojanLink = new URL(shadowrocketLinks.find((link) => link.startsWith("trojan://")));
  assert.equal(trojanLink.hostname, "192.0.2.4");
  assert.equal(trojanLink.searchParams.get("host"), "trojan.example.com");
  assert.equal(trojanLink.searchParams.get("path"), "/trojan");
  assert.equal(trojanLink.searchParams.get("allowInsecure"), "1");

  const relayLink = shadowrocketLinks.find((link) => link.includes("%E5%8A%A0%E6%8B%BF%E5%A4%A7%40relay"));
  assert.match(
    relayLink,
    /^ss:\/\/2022-blake3-aes-256-gcm:fixture-relay-password@oldyyz03451\.vgrapi\.xyz:50330\/\?chain=/,
  );
  assert.match(relayLink, /chain=%F0%9F%87%BA%F0%9F%87%B8%20%E7%BE%8E%E5%9B%BD%40c57s3/);
  assert.ok(!relayLink.includes("+"));
  assert.equal(new URL(relayLink).searchParams.get("chain"), "🇺🇸 美国@c57s3");

  installFetchMock({ subscriptionBody: shadowrocketYaml });
  const detectedShadowrocket = await worker.fetch(subscriptionRequest({
    target: "",
    userAgent: "ShAdOwRoCkEt/2.2.68 iOS/18.0",
  }));
  assert.equal(detectedShadowrocket.status, 200);
  assert.equal(detectedShadowrocket.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(detectedShadowrocket.headers.get("x-subscription-skipped"), "2");

  installFetchMock({ subscriptionBody: shadowrocketYaml });
  const forcedClash = await worker.fetch(subscriptionRequest({
    target: "clash",
    userAgent: "Shadowrocket/2.2.68",
  }));
  assert.equal(forcedClash.status, 200);
  assert.equal(forcedClash.headers.get("content-type"), "text/yaml; charset=utf-8");
  assert.match(await forcedClash.text(), /^mixed-port: 7890\n/);

  installFetchMock({ subscriptionBody: shadowrocketYaml });
  const shadowrocketHead = await worker.fetch(
    subscriptionRequest({ method: "HEAD", userAgent: "Shadowrocket/2.2.68" }),
  );
  assert.equal(shadowrocketHead.status, 200);
  assert.equal(shadowrocketHead.headers.get("x-subscription-skipped"), "2");
  assert.equal(await shadowrocketHead.text(), "");

  const unsupportedOnlyYaml = `proxies:\n${["c57s1", "c57s2", "c57s3", "c57s4", "c57s5", "c57s801"]
    .map((code, index) => `  - name: "JMS-100@${code}.example:1080"\n    type: socks5\n    server: "192.0.2.${index + 1}"\n    port: 1080`)
    .join("\n")}\n`;
  installFetchMock({ subscriptionBody: unsupportedOnlyYaml });
  const noShadowrocketNodes = await worker.fetch(subscriptionRequest({ target: "shadowrocket" }));
  assert.equal(noShadowrocketNodes.status, 422);
  assert.equal(noShadowrocketNodes.headers.get("x-subscription-skipped"), "6");

  const ss2022Link = serializeShadowrocketProxy({
    type: "ss",
    name: "2022 节点",
    server: "192.0.2.20",
    port: 443,
    cipher: "2022-blake3-aes-256-gcm",
    password: "a+b/secret",
  });
  assert.match(
    ss2022Link,
    /^ss:\/\/2022-blake3-aes-256-gcm:a%2Bb%2Fsecret@192\.0\.2\.20:443#2022%20%E8%8A%82%E7%82%B9$/,
  );

  installFetchMock();
  const shortTokenResult = await worker.fetch(
    subscriptionRequest({ token: defaultShortToken }),
    workerEnv,
  );
  assert.equal(shortTokenResult.status, 200);
  assert.equal(await shortTokenResult.text(), expectedYaml);

  const missingShortToken = await worker.fetch(
    subscriptionRequest({ token: "Z9y8X7w6V5" }),
    workerEnv,
  );
  assert.equal(missingShortToken.status, 400);
  assert.deepEqual(await missingShortToken.json(), { error: "token 无效或已失效" });

  installFetchMock();
  const legacyToken = Buffer.from(
    `${defaultService}|${defaultId}|${defaultPassword}`,
    "utf8",
  ).toString("base64");
  const legacyTokenResult = await worker.fetch(
    subscriptionRequest({ token: legacyToken }),
  );
  assert.equal(legacyTokenResult.status, 400);
  assert.deepEqual(await legacyTokenResult.json(), { error: "token 无效或已失效" });
  assert.equal(upstreamFetchCount, 0);

  tokenStore.set("Q1w2E3r4T5", "not-json");
  const malformedShortToken = await worker.fetch(
    subscriptionRequest({ token: "Q1w2E3r4T5" }),
    workerEnv,
  );
  assert.equal(malformedShortToken.status, 500);

  const missingTokenBinding = await deployedWorker.fetch(subscriptionRequest(), {});
  assert.equal(missingTokenBinding.status, 503);

  const unavailableTokenStore = await deployedWorker.fetch(subscriptionRequest(), {
    TOKENS: {
      async get() {
        throw new Error("KV unavailable");
      },
    },
  });
  assert.equal(unavailableTokenStore.status, 503);

  installFetchMock({ bandwidthOk: false });
  const noBalance = await worker.fetch(subscriptionRequest());
  assert.equal(noBalance.status, 200);
  assert.equal(noBalance.headers.get("subscription-userinfo"), null);
  assert.equal(await noBalance.text(), expectedYaml);

  installFetchMock({ subscriptionOk: false });
  const upstreamFailure = await worker.fetch(subscriptionRequest());
  assert.equal(upstreamFailure.status, 502);

  const missingFields = await worker.fetch(new Request("https://flower-sub.example/sub"));
  assert.equal(missingFields.status, 400);

  const badService = await worker.fetch(subscriptionRequest({ service: "abc" }));
  assert.equal(badService.status, 400);

  const badId = await worker.fetch(subscriptionRequest({ id: "not-a-uuid" }));
  assert.equal(badId.status, 400);

  const badToken = await worker.fetch(subscriptionRequest({ token: "not-base64!" }));
  assert.equal(badToken.status, 400);

  const fixedNow = Date.UTC(2026, 3, 30, 12, 0, 0);
  globalThis.Date = class extends realDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() {
      return fixedNow;
    }
  };
  installFetchMock({ resetDay: 31 });
  const monthEnd = await worker.fetch(subscriptionRequest());
  const monthEndInfo = monthEnd.headers.get("subscription-userinfo");
  assert.match(monthEndInfo, new RegExp(`expire=${Date.UTC(2026, 4, 31) / 1000}$`));
  globalThis.Date = realDate;

  const syntheticId = "11111111-2222-3333-4444-555555555555";
  const syntheticUris = [
    `ss://${Buffer.from("aes-256-gcm:test-password@192.0.2.1:10001").toString("base64")}#JMS-100%40c57s1.example%3A10001`,
    `ss://${Buffer.from("aes-256-gcm:test-password@192.0.2.2:10002").toString("base64")}#JMS-100%40c57s2.example%3A10002`,
    ...[
      ["c57s3", "192.0.2.3"],
      ["c57s4", "192.0.2.4"],
      ["c57s5", "192.0.2.5"],
      ["c57s801", "192.0.2.6"],
    ].map(([code, host]) =>
      `vless://${syntheticId}@${host}:443?encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=test-public-key&security=reality&sid=abcd&sni=example.com&type=tcp#JMS-100%40${code}.example%3A443`,
    ),
  ];
  const encodedSubscription = Buffer.from(syntheticUris.join("\n")).toString("base64");
  installFetchMock({ subscriptionBody: encodedSubscription });
  const encodedResult = await worker.fetch(
    subscriptionRequest({ id: syntheticId, password: "relay-password" }),
  );
  assert.equal(encodedResult.status, 200);
  const encodedYaml = await encodedResult.text();
  assert.match(encodedYaml, /server: "192\.0\.2\.1"/);
  assert.match(encodedYaml, /public-key: "test-public-key"/);
  assert.match(encodedYaml, /password: "relay-password"/);

  const encodedShadowrocket = await worker.fetch(
    subscriptionRequest({ id: syntheticId, password: "relay-password", target: "shadowrocket" }),
  );
  assert.equal(encodedShadowrocket.status, 200);
  assert.equal(encodedShadowrocket.headers.get("x-subscription-skipped"), "0");
  const encodedShadowrocketLinks = Buffer.from(
    await encodedShadowrocket.text(),
    "base64",
  ).toString("utf8").split("\n");
  assert.equal(encodedShadowrocketLinks.length, 7);
  assert.equal(encodedShadowrocketLinks.filter((link) => link.startsWith("ss://")).length, 3);
  const encodedRealityLinks = encodedShadowrocketLinks
    .filter((link) => link.startsWith("vless://"))
    .map((link) => new URL(link));
  assert.equal(encodedRealityLinks.length, 4);
  for (const link of encodedRealityLinks) {
    assert.equal(link.searchParams.get("security"), "reality");
    assert.equal(link.searchParams.get("type"), "tcp");
    assert.equal(link.searchParams.get("sni"), "example.com");
    assert.equal(link.searchParams.get("fp"), "chrome");
    assert.equal(link.searchParams.get("pbk"), "test-public-key");
    assert.equal(link.searchParams.get("sid"), "abcd");
    assert.equal(link.searchParams.get("flow"), "xtls-rprx-vision");
  }
  const encodedRelayLink = encodedShadowrocketLinks.find((link) =>
    link.includes("%E5%8A%A0%E6%8B%BF%E5%A4%A7%40relay")
  );
  assert.equal(new URL(encodedRelayLink).searchParams.get("chain"), "🇺🇸 美国@c57s3");

  installFetchMock();
  const specialPassword = 'a+b/="quoted"';
  const escaped = await worker.fetch(subscriptionRequest({ password: specialPassword }));
  assert.equal(escaped.status, 200);
  assert.ok((await escaped.text()).includes('password: "a+b/=\\"quoted\\""'));

  await flushBackgroundTasks();
  historyDb.reset();

  installFetchMock();
  const recordedSuccess = await worker.fetch(subscriptionRequest({ ip: "198.51.100.10" }));
  assert.equal(recordedSuccess.status, 200);
  await flushBackgroundTasks();

  installFetchMock();
  const recordedHead = await worker.fetch(subscriptionRequest({
    ip: "2001:db8::10",
    method: "HEAD",
  }));
  assert.equal(recordedHead.status, 200);
  await flushBackgroundTasks();

  installFetchMock({ subscriptionOk: false });
  const recordedFailure = await worker.fetch(subscriptionRequest({ ip: "198.51.100.11" }));
  assert.equal(recordedFailure.status, 502);
  await flushBackgroundTasks();

  const recordedBadTarget = await worker.fetch(subscriptionRequest({
    ip: "198.51.100.12",
    target: "surge",
  }));
  assert.equal(recordedBadTarget.status, 400);
  await flushBackgroundTasks();

  assert.deepEqual(
    historyDb.events.map(({ ip, method, status_code: statusCode }) => ({
      ip,
      method,
      statusCode,
    })),
    [
      { ip: "198.51.100.10", method: "GET", statusCode: 200 },
      { ip: "2001:db8::10", method: "HEAD", statusCode: 200 },
      { ip: "198.51.100.11", method: "GET", statusCode: 502 },
      { ip: "198.51.100.12", method: "GET", statusCode: 400 },
    ],
  );
  assert.equal(historyDb.events[0].token_hash, await hashToken(defaultShortToken));
  assert.ok(!JSON.stringify(historyDb.events).includes(defaultShortToken));

  const eventCount = historyDb.events.length;
  const invalidSubscription = await worker.fetch(
    subscriptionRequest({ token: "Z9y8X7w6V5" }),
  );
  assert.equal(invalidSubscription.status, 400);
  const rejectedMethod = await worker.fetch(subscriptionRequest({ method: "POST" }));
  assert.equal(rejectedMethod.status, 405);
  await flushBackgroundTasks();
  assert.equal(historyDb.events.length, eventCount);

  const firstHistoryPage = await worker.fetch(historyRequest({ limit: "2" }));
  assert.equal(firstHistoryPage.status, 200);
  assert.equal(firstHistoryPage.headers.get("cache-control"), "no-store");
  assert.equal(
    firstHistoryPage.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  const firstHistoryData = (await firstHistoryPage.json()).data;
  assert.equal(firstHistoryData.items.length, 2);
  assert.equal(firstHistoryData.items[0].ip, "198.51.100.12");
  assert.equal(firstHistoryData.items[0].statusCode, 400);
  assert.equal(firstHistoryData.items[0].success, false);
  assert.equal(firstHistoryData.items[1].ip, "198.51.100.11");
  assert.equal(firstHistoryData.items[1].success, false);
  assert.equal(typeof firstHistoryData.nextCursor, "string");

  const secondHistoryPage = await worker.fetch(historyRequest({
    cursor: firstHistoryData.nextCursor,
    limit: "2",
  }));
  const secondHistoryData = (await secondHistoryPage.json()).data;
  assert.deepEqual(
    secondHistoryData.items.map((item) => item.ip),
    ["2001:db8::10", "198.51.100.10"],
  );
  assert.equal(secondHistoryData.nextCursor, null);
  assert.match(secondHistoryData.items[0].requestedAt, /^\d{4}-\d{2}-\d{2}T/);

  const historyReads = historyDb.readCount;
  const queryTokenOnly = await worker.fetch(historyRequest({
    queryToken: defaultShortToken,
    token: null,
  }));
  assert.equal(queryTokenOnly.status, 404);
  assert.deepEqual(await queryTokenOnly.json(), { error: "接口不存在" });
  const missingAuthorization = await worker.fetch(historyRequest({ token: null }));
  assert.equal(missingAuthorization.status, 404);
  const invalidAuthorization = await worker.fetch(historyRequest({ token: "Z9y8X7w6V5" }));
  assert.equal(invalidAuthorization.status, 404);
  const unavailableTokenStoreForHistory = await worker.fetch(historyRequest(), {
    HISTORY_DB: historyDb,
    TOKENS: {
      async get() {
        throw new Error("KV unavailable");
      },
    },
  });
  assert.equal(unavailableTokenStoreForHistory.status, 404);
  assert.equal(historyDb.readCount, historyReads);

  const historyHead = await worker.fetch(historyRequest({ method: "HEAD" }));
  assert.equal(historyHead.status, 405);
  assert.equal(historyHead.headers.get("allow"), "GET");
  const invalidLimit = await worker.fetch(historyRequest({ limit: "501" }));
  assert.equal(invalidLimit.status, 400);
  const invalidCursor = await worker.fetch(historyRequest({ cursor: "not-a-cursor" }));
  assert.equal(invalidCursor.status, 400);

  const originalWarn = console.warn;
  const capturedWarnings = [];
  console.warn = (...args) => capturedWarnings.push(args);
  try {
    const missingHistoryBinding = await worker.fetch(historyRequest(), {
      TOKENS: workerEnv.TOKENS,
    });
    assert.equal(missingHistoryBinding.status, 503);

    historyDb.failReads = true;
    const failedHistoryRead = await worker.fetch(historyRequest());
    assert.equal(failedHistoryRead.status, 503);
    historyDb.failReads = false;

    historyDb.failWrites = true;
    installFetchMock();
    const failedHistoryWrite = await worker.fetch(subscriptionRequest());
    assert.equal(failedHistoryWrite.status, 200);
    await flushBackgroundTasks();
    historyDb.failWrites = false;

    const missingIp = await worker.fetch(subscriptionRequest({ ip: null }));
    assert.equal(missingIp.status, 200);
    await flushBackgroundTasks();
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(capturedWarnings.some(([message]) =>
    message === "Failed to read subscription history"
  ));
  assert.ok(capturedWarnings.some(([message]) =>
    message === "Failed to record subscription history"
  ));
  assert.ok(capturedWarnings.some(([message]) =>
    message === "Skipping subscription history: CF-Connecting-IP is missing"
  ));

  historyDb.reset();
  installFetchMock({ subscriptionBody: "not a subscription" });
  const recordedConversionFailure = await worker.fetch(subscriptionRequest({
    ip: "198.51.100.13",
  }));
  assert.equal(recordedConversionFailure.status, 502);
  await flushBackgroundTasks();
  assert.deepEqual(
    historyDb.events.map(({ ip, status_code: statusCode }) => ({ ip, statusCode })),
    [{ ip: "198.51.100.13", statusCode: 502 }],
  );

  historyDb.reset();
  const currentTime = Date.now();
  const tokenHash = await hashToken(defaultShortToken);
  historyDb.events = [
    {
      id: 1,
      ip: "198.51.100.20",
      method: "GET",
      requested_at: currentTime,
      status_code: 200,
      token_hash: tokenHash,
    },
    {
      id: 2,
      ip: "198.51.100.21",
      method: "GET",
      requested_at: currentTime,
      status_code: 502,
      token_hash: tokenHash,
    },
    {
      id: 3,
      ip: "198.51.100.22",
      method: "GET",
      requested_at: currentTime - 72 * 60 * 60 * 1000 - 1,
      status_code: 200,
      token_hash: tokenHash,
    },
  ];
  historyDb.nextId = 4;

  const sameMillisecondPage = await worker.fetch(historyRequest({ limit: "1" }));
  const sameMillisecondData = (await sameMillisecondPage.json()).data;
  assert.deepEqual(
    sameMillisecondData.items.map((item) => item.ip),
    ["198.51.100.21"],
  );
  const sameMillisecondNext = await worker.fetch(historyRequest({
    cursor: sameMillisecondData.nextCursor,
    limit: "1",
  }));
  assert.deepEqual(
    (await sameMillisecondNext.json()).data.items.map((item) => item.ip),
    ["198.51.100.20"],
  );

  await deployedWorker.scheduled({}, workerEnv, executionContext);
  await flushBackgroundTasks();
  assert.deepEqual(
    historyDb.events.map((event) => event.ip),
    ["198.51.100.20", "198.51.100.21"],
  );

  const help = await worker.fetch(new Request("https://flower-sub.example/"));
  assert.equal(help.status, 200);
  assert.match(await help.text(), /GET \/sub\?token=/);

  console.log("All worker tests passed");
} finally {
  globalThis.fetch = realFetch;
  globalThis.Date = realDate;
}
