export default function FunnelLoading() {
  return (
    <main className="app-layout loading-layout" aria-busy="true">
      <aside className="app-sidebar">
        <div className="skeleton skeleton-brand" />
        <div className="skeleton skeleton-nav" />
        <div className="skeleton skeleton-nav" />
      </aside>
      <section className="app-content">
        <div className="dashboard-main">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-chart" />
          <div className="skeleton skeleton-chart" />
        </div>
      </section>
    </main>
  );
}
