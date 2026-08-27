import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONFIG_HEAD, FIXED_TAIL } from "./src/worker/config.generated.js";
import { buildRelayNode } from "./src/worker/relay.js";

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
  return new Request(url);
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
  assert.match(
    subscriptionInfo,
    /^upload=0; download=62665088049; total=500000000000; expire=\d+$/,
  );
  const expire = Number(subscriptionInfo.match(/expire=(\d+)/)[1]);
  const expireDate = new Date(expire * 1000);
  assert.ok(expire * 1000 > Date.now());
  assert.equal(expireDate.getUTCDate(), 18);
  assert.equal(success.headers.get("x-subscription-reset-day"), "18");
  assert.equal(await success.text(), expectedYaml);

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
