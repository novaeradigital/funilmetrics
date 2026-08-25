import {describe,expect,it} from "vitest";
import {buildCampaignRecommendations,type CampaignObservation} from "./campaign-recommendations";
const campaign=(partial:Partial<CampaignObservation>):CampaignObservation=>({
  id:"campaign-1",name:"Campanha",effectiveStatus:"ACTIVE",currency:"BRL",
  spend:0,impressions:0,clicks:0,...partial});
describe("campaign recommendations",()=>{
  it("flags active campaign without observed delivery",()=>{
    expect(buildCampaignRecommendations([campaign({})])[0]?.code).toBe("no_delivery");
  });
  it("does not compare CPC across currencies",()=>{
    const result=buildCampaignRecommendations([
      campaign({id:"a",currency:"BRL",spend:1_000,impressions:10_000,clicks:100}),
      campaign({id:"b",currency:"USD",spend:1_000,impressions:10_000,clicks:20})]);
    expect(result.some(item=>item.code==="high_relative_cpc")).toBe(false);
  });
  it("flags low relative CTR only after minimum volume",()=>{
    const result=buildCampaignRecommendations([
      campaign({id:"a",spend:500,impressions:10_000,clicks:500}),
      campaign({id:"b",spend:100,impressions:2_000,clicks:10})]);
    expect(result.some(item=>item.campaignId==="b"&&item.code==="low_relative_ctr")).toBe(true);
  });
});
