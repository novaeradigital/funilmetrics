export type DashboardMetricDefinition = {
  key: string;
  label: string;
  description: string;
  format: "currency" | "integer" | "percentage" | "decimal";
  supportedWidgets: readonly string[];
  ruleVersion: string;
};

const supported=["kpi","time_series","bar","table","comparison"] as const;
export const dashboardMetricCatalog:readonly DashboardMetricDefinition[]=[
 {key:"gross_revenue",label:"Receita bruta",description:"Efeitos financeiros positivos de pagamentos aprovados.",
  format:"currency",ruleVersion:"financial_v1",supportedWidgets:supported},
 {key:"net_revenue",label:"Receita líquida",description:"Receita bruta menos efeitos negativos observados.",
  format:"currency",ruleVersion:"financial_v1",supportedWidgets:supported},
 {key:"approved_payments",label:"Pagamentos aprovados",description:"Pagamentos distintos com efeito financeiro positivo.",
  format:"integer",ruleVersion:"financial_v1",supportedWidgets:supported},
 {key:"reversed_payments",label:"Pagamentos revertidos",description:"Pagamentos com reembolso ou chargeback observado.",
  format:"integer",ruleVersion:"financial_v1",supportedWidgets:supported},
 {key:"meta_spend",label:"Investimento Meta",description:"Investimento informado pela Meta na moeda da conta.",
  format:"currency",ruleVersion:"meta_insights_v1",supportedWidgets:supported},
 {key:"meta_impressions",label:"Impressões Meta",description:"Impressões observadas na Meta no período.",
  format:"integer",ruleVersion:"meta_insights_v1",supportedWidgets:supported},
 {key:"meta_clicks",label:"Cliques Meta",description:"Cliques observados na Meta no período.",
  format:"integer",ruleVersion:"meta_insights_v1",supportedWidgets:supported},
 {key:"meta_link_clicks",label:"Cliques no link Meta",description:"Cliques no link de destino observados na Meta.",
  format:"integer",ruleVersion:"meta_insights_v1",supportedWidgets:supported},
];

export function getDashboardMetric(key:string){
  return dashboardMetricCatalog.find((metric)=>metric.key===key);
}
