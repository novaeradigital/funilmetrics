export default function SalesLoading() {
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
          <div className="sales-summary">
            {Array.from({ length: 4 }).map((_, index) => <div className="skeleton skeleton-kpi" key={index} />)}
          </div>
          <div className="skeleton skeleton-chart" />
        </div>
      </section>
    </main>
  );
}
