export default function Loading(){
 return <main className="dashboard-route-state" aria-busy="true" aria-live="polite">
  <div className="dashboard-state-card"><span className="dashboard-state-spinner" aria-hidden="true"/>
   <p className="eyebrow">Dashboards</p><h1>Carregando sua análise</h1>
   <p>Consultando versões, permissões e métricas do projeto atual.</p>
  </div>
 </main>;
}
