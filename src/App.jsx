import { useEffect, useState } from "react";
import Flag from "./Flag.jsx";

const nodes = [
  { flag: "us", name: "美国@c57s1", region: "美国 · c57s1", latency: 168, level: "ok" },
  { flag: "us", name: "美国@c57s2", region: "美国 · c57s2", latency: 176, level: "ok" },
  { flag: "us", name: "美国@c57s3", region: "美国 · c57s3", latency: 183, level: "ok" },
  { flag: "jp", name: "日本@c57s4", region: "日本 · c57s4", latency: 92, level: "fast" },
  { flag: "nl", name: "荷兰@c57s5", region: "荷兰 · c57s5", latency: 146, level: "ok" },
  {
    flag: "us",
    name: "美国@c57s801",
    region: "美国 · 0.1x 下载路线",
    latency: 203,
    level: "slow",
  },
];

const tickerItems = [
  "一个订阅地址，仅此而已",
  "SUBSCRIPTION ONLY",
  "CLASH / MIHOMO READY",
  "REFERENCE LATENCY ONLY",
];

// 延迟越低，计量条越长
function meterWidth(latency) {
  return Math.round(Math.min(94, Math.max(16, 138 - latency * 0.58)));
}

function useShanghaiClock() {
  const [time, setTime] = useState("--:--:--");

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const update = () => setTime(formatter.format(new Date()));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return time;
}

function countUp(valueEl) {
  const target = Number(valueEl.dataset.count);
  const numEl = valueEl.querySelector(".latency-num");
  if (!target || !numEl || valueEl.dataset.done === "1") return;
  valueEl.dataset.done = "1";

  const duration = 1150;
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    numEl.textContent = String(Math.round(eased * target)).padStart(3, "0");
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function App() {
  const clock = useShanghaiClock();

  useEffect(() => {
    const revealed = document.querySelectorAll("[data-reveal]");
    const finishAll = () =>
      revealed.forEach((el) => {
        el.classList.add("is-in");
        const valueEl = el.querySelector(".latency-value");
        if (valueEl) countUp(valueEl);
      });

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    ) {
      finishAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          entry.target.classList.add("is-in");
          const valueEl = entry.target.querySelector(".latency-value");
          if (valueEl) countUp(valueEl);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -48px" },
    );

    revealed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const year = new Date().getFullYear();

  return (
    <>
      <nav className="topbar" aria-label="主导航">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="回到顶部">
            <span className="brand-mark">f/</span>
            <span>flower-sub</span>
          </a>
          <span className="topbar-clock" title="北京时间">
            <i className="clock-live" aria-hidden="true" />
            上海 {clock}
          </span>
        </div>
      </nav>

      <main className="page-shell">
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[0, 1].map((seg) => (
              <div className="ticker-seg" key={seg}>
                {tickerItems.map((item) => (
                  <span className="ticker-item" key={item}>
                    <i className="tick-dot" />
                    {item}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section className="hero" id="top">
          <p className="kicker" style={{ "--i": 0 }}>
            SUBSCRIPTION ONLY
          </p>
          <h1>
            <span className="h1-line" style={{ "--i": 1 }}>
              这里只提供
            </span>
            <span className="h1-line h1-accent" style={{ "--i": 2 }}>
              一个订阅链接。
              <svg
                className="swash"
                viewBox="0 0 300 16"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M4 11 C 80 3, 210 2, 296 9" />
              </svg>
            </span>
          </h1>
          <p className="hero-text" style={{ "--i": 3 }}>
            一个订阅地址，仅此而已。页面里的延迟只是参考，
            真正的答案请交给你的 Clash / Mihomo 客户端。
          </p>
          <a className="hero-cue" href="#latency" style={{ "--i": 4 }}>
            继续往下看
            <svg
              className="cue-arrow"
              viewBox="0 0 12 20"
              aria-hidden="true"
            >
              <path d="M6 2v15m0 0-4.5-4.5M6 17l4.5-4.5" />
            </svg>
          </a>
        </section>

        <section
          className="latency-section"
          id="latency"
          aria-labelledby="latency-title"
        >
          <div className="section-heading" data-reveal>
            <div>
              <p className="kicker">NODE LATENCY</p>
              <h2 id="latency-title">下面看看节点延迟</h2>
            </div>
            <span className="reference-badge">
              <i className="badge-ping" />
              参考数据
            </span>
          </div>

          <div className="node-grid">
            {nodes.map((node, index) => (
              <article
                className="node-card"
                key={node.name}
                data-reveal
                style={{ "--i": index }}
              >
                <div className="node-info">
                  <span className="node-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>
                      <Flag code={node.flag} />
                      {node.name}
                    </strong>
                    <span className="node-region">
                      <i className={`node-dot dot-${node.level}`} />
                      {node.region}
                    </span>
                  </div>
                </div>
                <span
                  className={`latency-value latency-${node.level}`}
                  data-count={node.latency}
                >
                  <span className="latency-num">{node.latency}</span>
                  <small>ms</small>
                </span>
                <div className="latency-meter" aria-hidden="true">
                  <i
                    className={node.level}
                    style={{ "--w": `${meterWidth(node.latency)}%` }}
                  />
                </div>
              </article>
            ))}
          </div>

          <p className="latency-footnote" data-reveal>
            <span className="footnote-mark">i</span>
            延迟数值仅作页面参考，实际结果会因网络环境变化，请以 Clash / Mihomo
            客户端测速为准。
          </p>
        </section>

        <footer className="footer" data-reveal>
          <span className="footer-brand">flower-sub</span>
          <span className="footer-note">
            一个订阅地址，仅此而已。© {year}
          </span>
          <a className="to-top" href="#top">
            回到顶部 ↑
          </a>
        </footer>
      </main>
    </>
  );
}

export default App;
