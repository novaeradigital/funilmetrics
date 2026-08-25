import {describe,expect,it} from "vitest";
import {desiredMetaStatus,metaDailyBudgetMatches,metaNameMatches,metaStateMatches,sanitizeMetaResponse} from "./meta-manager-execution";
describe("meta manager execution",()=>{
 it("maps actions",()=>{expect(desiredMetaStatus("activate")).toBe("ACTIVE");expect(desiredMetaStatus("pause")).toBe("PAUSED");});
 it("confirms configured status",()=>{expect(metaStateMatches({status:"PAUSED"},"PAUSED")).toBe(true);expect(metaStateMatches({status:"ACTIVE"},"PAUSED")).toBe(false);});
 it("confirms an exact edited name",()=>{expect(metaNameMatches({name:"Campanha nova"},"Campanha nova")).toBe(true);expect(metaNameMatches({name:"Campanha antiga"},"Campanha nova")).toBe(false);});
 it("confirms the daily budget in minor units",()=>{expect(metaDailyBudgetMatches({daily_budget:"1250"},1250)).toBe(true);expect(metaDailyBudgetMatches({daily_budget:1300},1250)).toBe(false);});
 it("sanitizes responses",()=>{expect(sanitizeMetaResponse({id:"1",success:true,access_token:"secret",error:{message:"bad",code:190,fbtrace_id:"trace"}})).toEqual({id:"1",success:true,error:{message:"bad",type:"",code:190,subcode:null}});});
 it("keeps only governed edit fields",()=>{expect(sanitizeMetaResponse({id:"1",name:"Novo",daily_budget:"2500",access_token:"secret"})).toEqual({id:"1",name:"Novo",daily_budget:"2500"});});
});
