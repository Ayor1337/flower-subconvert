export function buildUpstreamUrl(base, service, id) {
  const url = new URL(base);
  url.searchParams.set("service", service);
  url.searchParams.set("id", id);
  return url;
}

export async function fetchSubscription(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/yaml, application/yaml, text/plain, */*",
      "User-Agent": "ClashMeta",
    },
  });

  if (!response.ok) {
    throw new Error("subscription upstream failed");
  }

  const text = await response.text();
  if (!text || /^\s*</.test(text)) {
    throw new Error("subscription upstream returned non-YAML content");
  }
  return text;
}

// JustMySocks 按十进制 GB（1 GB = 10^9 B）统计流量，而 Clash/Mihomo 等客户端
// 把 subscription-userinfo 的字节数按 GiB（2^30 B）换算后显示。若直接透传，
// 客户端会把 66.68 GB 显示成 62.1 GiB、500 GB 显示成 466 GiB。这里预乘
// 2^30 / 10^9 ≈ 1.0737，客户端再除回 2^30 时刚好还原成面板的十进制数字。
const GIB_PER_DECIBYTE = 1024 ** 3 / 1e9;

function alignWithPanel(bytes) {
  return Math.round(bytes * GIB_PER_DECIBYTE);
}

export async function fetchBandwidth(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("bandwidth upstream failed");
  }

  const data = await response.json();
  const total = toNonNegativeInteger(data.monthly_bw_limit_b);
  const used = toNonNegativeInteger(data.bw_counter_b);
  const resetDay = toNonNegativeInteger(data.bw_reset_day_of_month);

  if (total === null || used === null || resetDay === null || resetDay < 1 || resetDay > 31) {
    throw new Error("bandwidth upstream returned invalid data");
  }

  return { total: alignWithPanel(total), used: alignWithPanel(used), resetDay };
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    return null;
  }
  return number;
}
