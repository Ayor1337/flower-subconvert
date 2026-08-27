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

  return { total, used, resetDay };
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    return null;
  }
  return number;
}
