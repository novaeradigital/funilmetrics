export type CampaignObservation = {
  id: string; name: string; effectiveStatus: string | null; currency: string | null;
  spend: number; impressions: number; clicks: number;
};
export type CampaignRecommendation = {
  campaignId: string; campaignName: string; severity: "attention" | "info";
  code: "no_delivery" | "no_clicks" | "low_relative_ctr" | "high_relative_cpc";
  evidence: string; recommendation: string;
};
const activeStatuses = new Set(["ACTIVE", "CAMPAIGN_ACTIVE"]);

export function buildCampaignRecommendations(campaigns: CampaignObservation[]) {
  const result: CampaignRecommendation[] = [];
  const byCurrency = new Map<string, CampaignObservation[]>();
  for (const item of campaigns) {
    const currency = item.currency ?? "unknown";
    byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), item]);
    if (item.effectiveStatus && activeStatuses.has(item.effectiveStatus.toUpperCase())
      && item.impressions === 0) {
      result.push({campaignId:item.id,campaignName:item.name,severity:"attention",
        code:"no_delivery",evidence:"Campanha ativa sem impressões observadas no período.",
        recommendation:"Verifique entrega, período e atualização da integração antes de qualquer alteração."});
    } else if (item.impressions >= 1_000 && item.clicks === 0) {
      result.push({campaignId:item.id,campaignName:item.name,severity:"attention",
        code:"no_clicks",evidence:`${item.impressions.toLocaleString("pt-BR")} impressões e nenhum clique observado.`,
        recommendation:"Revise criativo, mensagem e destino; o sinal não identifica sozinho a causa."});
    }
  }
  for (const [, group] of byCurrency) {
    const totals=group.reduce((sum,item)=>({spend:sum.spend+item.spend,
      impressions:sum.impressions+item.impressions,clicks:sum.clicks+item.clicks}),
      {spend:0,impressions:0,clicks:0});
    const portfolioCtr=totals.impressions?totals.clicks/totals.impressions:0;
    const portfolioCpc=totals.clicks?totals.spend/totals.clicks:0;
    for (const item of group) {
      const ctr=item.impressions?item.clicks/item.impressions:0;
      const cpc=item.clicks?item.spend/item.clicks:0;
      if(totals.impressions>=5_000&&item.impressions>=1_000&&item.clicks>0
        &&portfolioCtr>0&&ctr<portfolioCtr*0.5) result.push({
          campaignId:item.id,campaignName:item.name,severity:"info",code:"low_relative_ctr",
          evidence:`CTR ${(ctr*100).toFixed(2)}%, abaixo de 50% do CTR observado no mesmo recorte e moeda.`,
          recommendation:"Investigue criativo, público e posicionamento; não pause apenas por este comparativo."});
      if(totals.clicks>=100&&item.clicks>=20&&portfolioCpc>0&&cpc>portfolioCpc*1.5)
        result.push({campaignId:item.id,campaignName:item.name,severity:"info",
          code:"high_relative_cpc",evidence:"CPC 50% ou mais acima do CPC agregado no mesmo recorte e moeda.",
          recommendation:"Compare público, posicionamento e criativo antes de preparar qualquer ação."});
    }
  }
  return result.slice(0,12);
}
