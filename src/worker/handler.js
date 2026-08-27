import { CONFIG_HEAD, FIXED_TAIL } from "./config.generated.js";
import { readCredentialsFromToken } from "./auth.js";
import { nextResetTimestamp } from "./date.js";
import { extractAndRenameProxies } from "./subscription.js";
import { buildRelayNode } from "./relay.js";
import { errorResponse, helpResponse } from "./responses.js";
import {
  buildUpstreamUrl,
  fetchBandwidth,
  fetchSubscription,
} from "./upstream.js";

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const isHead = request.method === "HEAD";

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

    const credentials = await readCredentialsFromToken(requestUrl.searchParams, env);
    if (credentials.error) {
      return errorResponse(credentials.status || 400, credentials.error, isHead);
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

    let proxyEntries;
    try {
      proxyEntries = extractAndRenameProxies(subscriptionResult.value);
    } catch {
      return errorResponse(502, "上游订阅格式不符合预期", isHead);
    }

    const relayNode = buildRelayNode(password);
    const body = CONFIG_HEAD + relayNode + "\n" + proxyEntries + "\n\n" + FIXED_TAIL + "\n";
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename*=UTF-8''JustMySocks",
      "Content-Type": "text/yaml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });

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
  },
};

