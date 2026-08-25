import {describe,expect,it} from "vitest";
import {validateDashboardAiProposal} from "./dashboard-ai-proposal";

describe("dashboard AI proposal",()=>{
 it("aceita somente composição governada",()=>expect(validateDashboardAiProposal({
  title:"Visão executiva",description:"Resumo",periodDays:30,
  widgets:[{title:"Receita",type:"kpi",metric:"net_revenue",width:4}],
 }).widgets).toHaveLength(1));
 it("recusa métrica inventada",()=>expect(()=>validateDashboardAiProposal({
  title:"Inválido",description:"",periodDays:30,
  widgets:[{title:"Causalidade",type:"kpi",metric:"roas_causal",width:4}],
 })).toThrow("dashboard_ai_invalid"));
});
