export const metaManagerColumnIds=[
 "selection","status","name","parent","budget","spend","impressions","clicks",
 "reach","frequency","cpm","ctr","cpc","landing_page_views",
 "cost_per_landing_page_view","initiate_checkout","cost_per_initiate_checkout",
] as const;

export function normalizeMetaManagerColumns(values:unknown){
 if(!Array.isArray(values))return [];
 const allowed=new Set<string>(metaManagerColumnIds);
 return values.filter((value,index):value is string=>
  typeof value==="string"&&allowed.has(value)&&values.indexOf(value)===index);
}
