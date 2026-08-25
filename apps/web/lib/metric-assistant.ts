export type MetricIntent="revenue"|"sales"|"utm_coverage"|"campaigns"|"unsupported";
const normalize=(value:string)=>value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
export function detectMetricIntent(question:string):MetricIntent{
 const text=normalize(question);
 if(/\b(utm|origem|atribuicao)\b/.test(text))return "utm_coverage";
 if(/\b(campanhas?|meta|anuncios?|trafego)\b/.test(text))return "campaigns";
 if(/\b(receita|faturamento|financeiro|reembolso|chargeback)\b/.test(text))return "revenue";
 if(/\b(vendas?|pedidos?|compras?|pagamentos?)\b/.test(text))return "sales";
 return "unsupported";
}
