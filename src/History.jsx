import { useState } from "react";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10}$/;
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : TIME_FORMATTER.format(date);
}

function historyErrorMessage(response, payload) {
  if (response.status === 404) return "TOKEN 无效或已失效";
  if (response.status === 503) return "历史记录暂时不可用，请稍后再试";
  return payload?.error || `查询失败（HTTP ${response.status}）`;
}

export default function History() {
  const [token, setToken] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queried, setQueried] = useState(false);

  async function fetchHistory(requestToken, cursor = null, append = false) {
    setLoading(true);
    setError("");
    if (!append) {
      setItems([]);
      setNextCursor(null);
    }

    try {
      const searchParams = new URLSearchParams({ limit: "100" });
      if (cursor) searchParams.set("cursor", cursor);
      const response = await fetch(`/sub/history?${searchParams}`, {
        headers: { Authorization: `Bearer ${requestToken}` },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // 非 JSON 响应会在下方按 HTTP 状态生成通用错误。
      }
      if (!response.ok) {
        throw new Error(historyErrorMessage(response, payload));
      }
      if (!Array.isArray(payload?.data?.items)) {
        throw new Error("历史接口返回格式无效");
      }

      setItems((current) => append
        ? [...current, ...payload.data.items]
        : payload.data.items
      );
      setNextCursor(payload.data.nextCursor || null);
      setQueried(true);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "查询失败，请稍后再试"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const normalizedToken = token.trim();
    if (!TOKEN_PATTERN.test(normalizedToken)) {
      setItems([]);
      setNextCursor(null);
      setQueried(false);
      setError("请输入 10 位 URL-safe TOKEN");
      return;
    }

    setActiveToken(normalizedToken);
    await fetchHistory(normalizedToken);
  }

  function handleClear() {
    setToken("");
    setActiveToken("");
    setItems([]);
    setNextCursor(null);
    setError("");
    setQueried(false);
  }

  return (
    <section
      className="history-section"
      id="history"
      aria-labelledby="history-title"
    >
      <div className="section-heading" data-reveal>
        <div>
          <p className="kicker">IP HISTORY</p>
          <h2 id="history-title">查看最近三天的订阅记录</h2>
        </div>
      </div>

      <div className="history-panel" data-reveal>
        <p className="history-description">
          输入订阅 TOKEN 后查询。TOKEN 只随本次请求发送，本页不会主动写入网址或本地存储。
        </p>

        <form className="history-form" onSubmit={handleSubmit}>
          <label htmlFor="history-token">订阅 TOKEN</label>
          <div className="history-controls">
            <input
              id="history-token"
              name="history-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="10 位 TOKEN"
              maxLength={10}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="history-token-help"
            />
            <button className="history-submit" type="submit" disabled={loading}>
              {loading && !items.length ? "查询中…" : "查询记录"}
            </button>
            {(token || queried || error) && (
              <button
                className="history-clear"
                type="button"
                onClick={handleClear}
                disabled={loading}
              >
                清除
              </button>
            )}
          </div>
          <span id="history-token-help" className="history-help">
            不接受订阅 URL，只输入其中的短 TOKEN。
          </span>
        </form>

        {error && <p className="history-message is-error" role="alert">{error}</p>}
        {!error && queried && !items.length && (
          <p className="history-message" role="status">最近三天没有订阅记录。</p>
        )}

        {items.length > 0 && (
          <div className="history-results" aria-live="polite">
            <div className="history-summary">
              <strong>查询结果</strong>
              <span>已显示 {items.length} 条</span>
            </div>
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>时间（上海）</th>
                    <th>IP</th>
                    <th>方法</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${item.requestedAt}-${item.ip}-${index}`}>
                      <td data-label="时间">
                        <time dateTime={item.requestedAt}>{formatTime(item.requestedAt)}</time>
                      </td>
                      <td data-label="IP"><code>{item.ip}</code></td>
                      <td data-label="方法"><code>{item.method}</code></td>
                      <td data-label="结果">
                        <span className={`history-status ${item.success ? "is-success" : "is-failure"}`}>
                          {item.success ? "成功" : "失败"} {item.statusCode}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor && (
              <button
                className="history-more"
                type="button"
                disabled={loading}
                onClick={() => fetchHistory(activeToken, nextCursor, true)}
              >
                {loading ? "加载中…" : "加载更多"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
