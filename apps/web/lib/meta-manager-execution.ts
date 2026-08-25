export type MetaExecutionState={id?:string;status?:string;effective_status?:string;name?:string;daily_budget?:string|number;lifetime_budget?:string|number};
export const desiredMetaStatus=(action:"activate"|"pause")=>action==="activate"?"ACTIVE":"PAUSED";
export const metaStateMatches=(state:MetaExecutionState,desired:string)=>state.status===desired;
export const metaNameMatches=(state:MetaExecutionState,desired:string)=>state.name===desired;
export const metaDailyBudgetMatches=(state:MetaExecutionState,desiredMinor:number)=>Number(state.daily_budget)===desiredMinor;
export function sanitizeMetaResponse(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=="object")return {};
 const source=value as Record<string,unknown>,safe:Record<string,unknown>={};
 for(const key of ["id","success","status","effective_status","name","daily_budget","lifetime_budget","error"]){
  if(!(key in source))continue;
  if(key==="error"&&source.error&&typeof source.error==="object"){
   const error=source.error as Record<string,unknown>;
   safe.error={message:String(error.message??"").slice(0,300),type:String(error.type??"").slice(0,80),code:error.code??null,subcode:error.error_subcode??null};
  }else safe[key]=source[key];
 }
 return safe;
}
