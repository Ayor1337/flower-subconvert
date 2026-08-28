import { CONFIG_HEAD, FIXED_TAIL } from "./config.generated.js";
import {
  readCredentialsFromAuthorization,
  readCredentialsFromToken,
} from "./auth.js";
import { nextResetTimestamp } from "./date.js";
import {
  HistoryQueryError,
  pruneSubscriptionHistory,
  readClientIp,
  readSubscriptionHistory,
  recordSubscriptionAttempt,
} from "./history.js";
import { extractAndRenameSubscription } from "./subscription.js";
import { buildRelayNode, buildShadowrocketRelayProxy } from "./relay.js";
import { errorResponse, helpResponse, jsonResponse } from "./responses.js";
import { buildShadowrocketSubscription } from "./shadowrocket.js";
import {
  buildUpstreamUrl,
  fetchBandwidth,
  fetchSubscription,
} from "./upstream.js";

export function resolveTarget(searchParams, headers) {
  const requestedTarget = searchParams.get("target");
  if (requestedTarget) {
    return requestedTarget.toLowerCase();
  }

  const userAgent = headers.get("user-agent") || "";
  return userAgent.toLowerCase().includes("shadowrocket")
    ? "shadowrocket"
    : "clash";
}

export default {
  async fetch(request, env, context) {
    const requestUrl = new URL(request.url);
    const isHead = request.method === "HEAD";

    if (requestUrl.pathname === "/sub/history") {
      return handleHistoryRequest(request, requestUrl, env);
    }

    if (request.method !== "GET" && !isHead) {
      return errorResponse(405, "仅支持 GET 和 HEAD 请求", isHead, {
        Allow: "GET, HEAD",
      });
    }

    if (requestUrl.pathname === "/" || requestUrl.pathname === "") {
      return helpResponse(isHead);
    }

    if (requestUrl.pathname !== "/sub") {
      return errorResponse(404, "接口不存在", isHead);
    }

    return handleSubscriptionRequest(request, requestUrl, env, context);
  },

  async scheduled(_controller, env, context) {
    const task = pruneSubscriptionHistory(env.HISTORY_DB).catch((error) => {
      console.warn("Failed to prune subscription history", error);
    });
    if (context && typeof context.waitUntil === "function") {
      context.waitUntil(task);
      return;
    }
    await task;
  },
};

async function handleHistoryRequest(request, requestUrl, env) {
  const credentials = await readCredentialsFromAuthorization(request.headers, env);
  if (credentials.error) {
    return errorResponse(404, "接口不存在", false);
  }

  if (request.method !== "GET") {
    return errorResponse(405, "仅支持 GET 请求", false, { Allow: "GET" });
  }

  try {
    const history = await readSubscriptionHistory(
      env.HISTORY_DB,
      credentials.token,
      requestUrl.searchParams,
    );
    return jsonResponse({ data: history });
  } catch (error) {
    if (error instanceof HistoryQueryError) {
      return errorResponse(400, error.message, false);
    }
    console.warn("Failed to read subscription history", error);
    return errorResponse(503, "历史记录暂时不可用", false);
  }
}

async function handleSubscriptionRequest(request, requestUrl, env, context) {
  const isHead = request.method === "HEAD";
  const requestedAt = Date.now();
  const credentials = await readCredentialsFromToken(requestUrl.searchParams, env);
  if (credentials.error) {
    return errorResponse(credentials.status || 400, credentials.error, isHead);
  }

  let response;
  try {
    response = await buildSubscriptionResponse(request, requestUrl, credentials);
  } catch (error) {
    console.warn("Unexpected subscription failure", error);
    response = errorResponse(500, "订阅处理失败", isHead);
  }

  scheduleSubscriptionHistory(context, env, {
    ip: readClientIp(request.headers),
    method: request.method,
    requestedAt,
    statusCode: response.status,
    token: (requestUrl.searchParams.get("token") || "").trim(),
  });
  return response;
}

async function buildSubscriptionResponse(request, requestUrl, credentials) {
  const isHead = request.method === "HEAD";

  const target = resolveTarget(requestUrl.searchParams, request.headers);
  if (target !== "clash" && target !== "shadowrocket") {
    return errorResponse(400, "不支持的订阅目标", isHead);
  }

  const { service, id, password } = credentials;
  const subscriptionUrl = buildUpstreamUrl(
    "https://jmssub.net/members/getsub.php",
    service,
    id,
  );
  const bandwidthUrl = buildUpstreamUrl(
    "https://justmysocks6.net/members/getbwcounter.php",
    service,
    id,
  );

  const [subscriptionResult, bandwidthResult] = await Promise.allSettled([
    fetchSubscription(subscriptionUrl),
    fetchBandwidth(bandwidthUrl),
  ]);

  if (subscriptionResult.status === "rejected") {
    return errorResponse(502, "无法获取或转换上游订阅", isHead);
  }

  let subscription;
  try {
    subscription = extractAndRenameSubscription(subscriptionResult.value);
  } catch {
    return errorResponse(502, "上游订阅格式不符合预期", isHead);
  }

  let body;
  let skipped = 0;
  if (target === "shadowrocket") {
    let result = buildShadowrocketSubscription(subscription.proxies);
    const hasDefaultChainNode = result.converted.some(
      (proxy) => proxy.name === "🇺🇸 美国@c57s3",
    );
    if (hasDefaultChainNode) {
      result = buildShadowrocketSubscription([
        ...subscription.proxies,
        buildShadowrocketRelayProxy(password),
      ]);
    }
    skipped = result.skipped.length;
    for (const item of result.skipped) {
      console.warn("Skipping Shadowrocket proxy", item);
    }
    if (!result.links.length) {
      return errorResponse(422, "没有可供 Shadowrocket 使用的节点", isHead, {
        "X-Subscription-Skipped": String(skipped),
      });
    }
    body = result.body;
  } else {
    const relayNode = buildRelayNode(password);
    body = CONFIG_HEAD + relayNode + "\n" + subscription.proxyEntries +
      "\n\n" + FIXED_TAIL + "\n";
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": target === "clash"
      ? "attachment; filename*=UTF-8''JustMySocks"
      : "attachment; filename*=UTF-8''JustMySocks.txt",
    "Content-Type": target === "clash"
      ? "text/yaml; charset=utf-8"
      : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (target === "shadowrocket") {
    headers.set("X-Subscription-Skipped", String(skipped));
  }

  if (bandwidthResult.status === "fulfilled") {
    const { total, used, resetDay } = bandwidthResult.value;
    const expire = nextResetTimestamp(resetDay);
    headers.set(
      "subscription-userinfo",
      "upload=0; download=" + used + "; total=" + total + "; expire=" + expire,
    );
    headers.set("x-subscription-reset-day", String(resetDay));
  }

  return new Response(isHead ? null : body, { status: 200, headers });
}

function scheduleSubscriptionHistory(context, env, event) {
  if (!event.ip) {
    console.warn("Skipping subscription history: CF-Connecting-IP is missing");
    return;
  }

  const task = recordSubscriptionAttempt(env.HISTORY_DB, event).catch((error) => {
    console.warn("Failed to record subscription history", error);
  });
  if (context && typeof context.waitUntil === "function") {
    context.waitUntil(task);
  }
}
