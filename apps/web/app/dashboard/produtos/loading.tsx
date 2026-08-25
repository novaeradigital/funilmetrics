export default function ProductsLoading() {
  return <main className="app-layout loading-layout" aria-busy="true"><aside className="app-sidebar"><div className="skeleton skeleton-brand" /></aside><section className="app-content"><div className="dashboard-main"><div className="skeleton skeleton-title" /><div className="executive-grid">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton skeleton-kpi" key={index} />)}</div><div className="skeleton skeleton-chart" /></div></section></main>;
}
