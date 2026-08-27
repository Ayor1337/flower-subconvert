const nodes = [
  { name: "🇺🇸 美国@c57s1", region: "美国 · c57s1", latency: 168, level: "ok" },
  { name: "🇺🇸 美国@c57s2", region: "美国 · c57s2", latency: 176, level: "ok" },
  { name: "🇺🇸 美国@c57s3", region: "美国 · c57s3", latency: 183, level: "ok" },
  { name: "🇯🇵 日本@c57s4", region: "日本 · c57s4", latency: 92, level: "fast" },
  { name: "🇳🇱 荷兰@c57s5", region: "荷兰 · c57s5", latency: 146, level: "ok" },
  {
    name: "🇺🇸 美国@c57s801",
    region: "美国 · 0.1x 下载路线",
    latency: 203,
    level: "slow",
  },
];

function App() {
  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="主导航">
        <a className="brand" href="#top" aria-label="回到顶部">
          <span className="brand-mark">f/</span>
          <span>flower-sub</span>
        </a>
        <span className="topbar-note">只提供订阅链接</span>
      </nav>

      <section className="hero" id="top">
        <p className="kicker">SUBSCRIPTION ONLY</p>
        <h1>
          这里只提供
          <br />
          <span>一个订阅链接。</span>
        </h1>
        <p className="hero-text">一个订阅地址，仅此而已。</p>
      </section>

      <section
        className="latency-section"
        id="latency"
        aria-labelledby="latency-title"
      >
        <div className="section-heading">
          <div>
            <p className="kicker">NODE LATENCY</p>
            <h2 id="latency-title">下面看看节点延迟</h2>
          </div>
          <span className="reference-badge">参考数据</span>
        </div>

        <div className="node-grid">
          {nodes.map((node, index) => (
            <article className="node-card" key={node.name}>
              <div className="node-info">
                <span className="node-index">0{index + 1}</span>
                <div>
                  <strong>{node.name}</strong>
                  <span>{node.region}</span>
                </div>
              </div>
              <span className={`latency-value latency-${node.level}`}>
                {node.latency}
                <small>ms</small>
              </span>
            </article>
          ))}
        </div>

        <p className="latency-footnote">
          <span className="footnote-mark">i</span>
          延迟数值仅作页面参考，实际结果会因网络环境变化，请以 Clash / Mihomo
          客户端测速为准。
        </p>
      </section>

      <footer className="footer">
        <span>flower-sub</span>
        <span>一个订阅地址，仅此而已。</span>
      </footer>
    </main>
  );
}

export default App;
