const block = {
  background: "#17171a",
  border: "1px solid #232328",
  borderRadius: 16,
} as const;

export default function DashboardV2Loading() {
  return (
    <main className="app-layout">
      <style>{`@keyframes fmPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
      <aside
        aria-hidden
        style={{ width: 248, flexShrink: 0, background: "#0c0c0e", borderRight: "1px solid #1d1d20" }}
      />
      <section className="app-content">
        <div style={{ animation: "fmPulse 1.4s ease-in-out infinite" }}>
          <div style={{ ...block, height: 32, width: 280, borderRadius: 10, marginBottom: 8 }} />
          <div style={{ ...block, height: 14, width: 340, borderRadius: 8, marginBottom: 22 }} />
          <div style={{ ...block, height: 52, marginBottom: 18 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 14,
              marginBottom: 14,
            }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ ...block, height: 118 }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div style={{ ...block, height: 300 }} />
            <div style={{ ...block, height: 300 }} />
          </div>
          <p style={{ color: "#71717a", fontSize: 13, marginTop: 16 }}>
            Carregando os dados do período…
          </p>
        </div>
      </section>
    </main>
  );
}
