import { useState } from "react";

const routes = [
  {
    method: "GET",
    path: "/",
    title: "服务说明",
    description: "查看当前服务的调用格式与安全提示。",
  },
  {
    method: "GET",
    path: "/sub",
    title: "动态订阅",
    description: "拉取上游订阅并转换成 Clash YAML 配置。",
  },
];

const features = [
  ["01", "自动转换", "同时支持 YAML 订阅与 Base64 编码的 SS / VLESS 节点。"],
  ["02", "节点归一", "按固定节点标识重命名，保证策略组引用保持稳定。"],
  ["03", "用量同步", "上游带宽信息可用时，自动写入订阅用量响应头。"],
];

function App() {
  const [copied, setCopied] = useState(false);
  const subscriptionPath = `${window.location.origin}/sub?token=<Base64(service|id|password)>`;

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(subscriptionPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="主导航">
        <a className="brand" href="#top" aria-label="回到顶部">
          <span className="brand-mark">f/</span>
          <span>flower-sub</span>
        </a>
        <span className="status-pill">
          <span className="status-dot" />
          Worker online
        </span>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">DYNAMIC SUBSCRIPTION SERVICE</p>
          <h1>
            让订阅配置
            <br />
            <span>始终井然有序。</span>
          </h1>
          <p className="hero-text">
            flower-sub 从上游订阅中提取节点、统一命名并拼接策略组，输出可以直接交给
            Clash 使用的 YAML 配置。
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#usage">
              查看调用方式 <span aria-hidden="true">↘</span>
            </a>
            <a className="text-link" href="#routes">
              浏览接口 <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="服务流程示意图">
          <div className="orb orb-large" />
          <div className="orb orb-small" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="signal-card signal-card-top">
            <span className="signal-label">INPUT</span>
            <strong>UPSTREAM</strong>
            <span className="signal-icon">↗</span>
          </div>
          <div className="signal-card signal-card-bottom">
            <span className="signal-label">OUTPUT</span>
            <strong>CLASH YAML</strong>
            <span className="signal-icon">✓</span>
          </div>
          <div className="visual-caption">
            <span>SAFE BY DEFAULT</span>
            <span>NO STORE</span>
          </div>
        </div>
      </section>

      <section className="feature-grid" aria-label="服务能力">
        {features.map(([number, title, description]) => (
          <article className="feature-card" key={number}>
            <span className="feature-number">{number}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="content-section" id="usage">
        <div className="section-heading">
          <p className="kicker">QUICK START</p>
          <h2>只需要一个 Token。</h2>
          <p>Token 原文格式为 service|id|password，请将完整 URL 当作敏感信息处理。</p>
        </div>
        <div className="usage-panel">
          <div className="usage-copy">
            <span className="panel-label">SUBSCRIPTION URL</span>
            <code>{subscriptionPath}</code>
            <p>
              将示例中的占位内容替换为 UTF-8 字符串的 Base64 编码，然后粘贴到 Clash
              客户端的订阅地址中。
            </p>
          </div>
          <button className="copy-button" type="button" onClick={copyExample}>
            {copied ? "已复制" : "复制示例"}
            <span aria-hidden="true">{copied ? "✓" : "↗"}</span>
          </button>
        </div>
      </section>

      <section className="content-section route-section" id="routes">
        <div className="section-heading split-heading">
          <div>
            <p className="kicker">ROUTE CONTRACT</p>
            <h2>清晰、克制的接口。</h2>
          </div>
          <p>服务端仍由根目录的 <code>worker.js</code> 提供，React 页面只负责说明与引导。</p>
        </div>
        <div className="route-list">
          {routes.map((route) => (
            <div className="route-row" key={route.path}>
              <span className="method-badge">{route.method}</span>
              <code>{route.path}</code>
              <div className="route-description">
                <strong>{route.title}</strong>
                <span>{route.description}</span>
              </div>
              <span className="route-arrow" aria-hidden="true">↗</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>flower-sub / edge subscription utility</span>
        <span>Built for focused routing.</span>
      </footer>
    </main>
  );
}

export default App;
