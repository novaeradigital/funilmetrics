"use client";

export default function ErrorState({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <main className="dashboard-route-state">
  <div className="dashboard-state-card error"><span aria-hidden="true">!</span>
   <p className="eyebrow">Falha ao carregar</p><h1>Não conseguimos abrir os dashboards</h1>
   <p>Os dados permanecem preservados. Tente novamente para refazer a consulta.</p>
   <button type="button" onClick={reset}>Tentar novamente</button>
  </div>
 </main>;
}
