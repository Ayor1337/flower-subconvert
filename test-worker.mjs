import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONFIG_HEAD, FIXED_TAIL } from "./src/worker/config.generated.js";
import { buildRelayNode } from "./src/worker/relay.js";
import { serializeShadowrocketProxy } from "./src/worker/shadowrocket.js";

const workerModule = await import(new URL(`./worker.js?test=${Date.now()}`, import.meta.url));
const worker = workerModule.default;
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
const workerEnv = {
  TOKENS: {
    async get(key) {
      return tokenStore.get(key) ?? null;
    },
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

function installFetchMock({
  bandwidthOk = true,
  resetDay = 18,
  subscriptionBody = sourceYaml,
  subscriptionOk = true,
} = {}) {
  globalThis.fetch = async (input) => {
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
  const token = params.token ?? Buffer.from(`${service}|${id}|${password}`, "utf8").toString("base64");
  url.searchParams.set("token", token);
  if (params.target !== undefined) url.searchParams.set("target", params.target);
  const headers = params.userAgent === undefined
    ? undefined
    : { "User-Agent": params.userAgent };
  return new Request(url, { headers, method: params.method || "GET" });
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

  tokenStore.set("Q1w2E3r4T5", "not-json");
  const malformedShortToken = await worker.fetch(
    subscriptionRequest({ token: "Q1w2E3r4T5" }),
    workerEnv,
  );
  assert.equal(malformedShortToken.status, 500);

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

  const badTokenShape = await worker.fetch(
    subscriptionRequest({ token: Buffer.from("only|two", "utf8").toString("base64") }),
  );
  assert.equal(badTokenShape.status, 400);

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

  const help = await worker.fetch(new Request("https://flower-sub.example/"));
  assert.equal(help.status, 200);
  assert.match(await help.text(), /GET \/sub\?token=/);

  console.log("All worker tests passed");
} finally {
  globalThis.fetch = realFetch;
  globalThis.Date = realDate;
}
