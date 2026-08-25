type TemplateWidget={title:string;type:"kpi"|"time_series"|"bar";metric:string;width:number};
type DashboardTemplate={key:string;name:string;description:string;widgets:readonly TemplateWidget[]};

export const dashboardTemplates:readonly DashboardTemplate[]=[
 {key:"overview",name:"Visão geral",description:"Receita, vendas e mídia disponível em uma leitura compacta.",widgets:[
  {title:"Faturamento",type:"kpi",metric:"gross_revenue",width:3},{title:"Investimento",type:"kpi",metric:"meta_spend",width:3},
  {title:"Vendas aprovadas",type:"kpi",metric:"approved_payments",width:3},{title:"Reversões",type:"kpi",metric:"reversed_payments",width:3},
  {title:"Desempenho por dia",type:"time_series",metric:"net_revenue",width:12}]},
 {key:"performance",name:"Performance",description:"Entrega e resposta observadas nas integrações de mídia.",widgets:[
  {title:"Investimento",type:"kpi",metric:"meta_spend",width:4},{title:"Impressões",type:"kpi",metric:"meta_impressions",width:4},
  {title:"Cliques",type:"kpi",metric:"meta_clicks",width:4},{title:"Evolução do investimento",type:"time_series",metric:"meta_spend",width:12}]},
 {key:"executive",name:"Executivo",description:"Indicadores governados para uma leitura gerencial.",widgets:[
  {title:"Receita líquida",type:"kpi",metric:"net_revenue",width:3},{title:"Receita bruta",type:"kpi",metric:"gross_revenue",width:3},
  {title:"Pagamentos aprovados",type:"kpi",metric:"approved_payments",width:3},{title:"Investimento Meta",type:"kpi",metric:"meta_spend",width:3}]},
 {key:"sales",name:"Vendas",description:"Aprovações, receita e reversões comerciais observadas.",widgets:[
  {title:"Receita bruta",type:"kpi",metric:"gross_revenue",width:4},{title:"Receita líquida",type:"kpi",metric:"net_revenue",width:4},
  {title:"Vendas aprovadas",type:"kpi",metric:"approved_payments",width:4},{title:"Receita por dia",type:"bar",metric:"gross_revenue",width:8},
  {title:"Reversões",type:"bar",metric:"reversed_payments",width:4}]},
 {key:"products",name:"Produtos",description:"Análise por presença do produto, sem rateio financeiro artificial.",widgets:[
  {title:"Vendas aprovadas",type:"kpi",metric:"approved_payments",width:4},{title:"Receita observada",type:"kpi",metric:"gross_revenue",width:4},
  {title:"Reversões",type:"kpi",metric:"reversed_payments",width:4},{title:"Evolução por produto",type:"time_series",metric:"approved_payments",width:12}]},
 {key:"acquisition",name:"Aquisição",description:"Mídia paga e origem registrada, sem atribuição multitoque implícita.",widgets:[
  {title:"Investimento Meta",type:"kpi",metric:"meta_spend",width:4},{title:"Impressões Meta",type:"kpi",metric:"meta_impressions",width:4},
  {title:"Cliques Meta",type:"kpi",metric:"meta_clicks",width:4},{title:"Investimento por dia",type:"bar",metric:"meta_spend",width:12}]},
 {key:"financial",name:"Financeiro",description:"Receita e reversões comprovadas pela fonte comercial.",widgets:[
  {title:"Receita bruta",type:"kpi",metric:"gross_revenue",width:3},{title:"Receita líquida",type:"kpi",metric:"net_revenue",width:3},
  {title:"Aprovados",type:"kpi",metric:"approved_payments",width:3},{title:"Revertidos",type:"kpi",metric:"reversed_payments",width:3},
  {title:"Evolução da receita",type:"time_series",metric:"net_revenue",width:12}]},
 {key:"quality",name:"Qualidade",description:"Sinais observados que exigem conferência operacional.",widgets:[
  {title:"Pagamentos aprovados",type:"kpi",metric:"approved_payments",width:6},{title:"Pagamentos revertidos",type:"kpi",metric:"reversed_payments",width:6},
  {title:"Reversões ao longo do tempo",type:"time_series",metric:"reversed_payments",width:12}]},
 {key:"blank",name:"Em branco",description:"Canvas vazio para montar uma visão do zero.",widgets:[]},
];

export function getDashboardTemplate(key:string){return dashboardTemplates.find(template=>template.key===key)}
