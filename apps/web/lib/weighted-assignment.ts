import {createHash} from "node:crypto";
export type WeightedVariant={id:string;weight:number};
export function assignWeighted<T extends WeightedVariant>(
  visitorKey:string,experimentId:string,variants:T[],
):T{
  const total=variants.reduce((sum,item)=>sum+item.weight,0);
  if(total<=0)throw new Error("variant_weight_total_invalid");
  const digest=createHash("sha256").update(`${experimentId}:${visitorKey}`).digest();
  const point=digest.readUInt32BE(0)%total;
  let cursor=0;
  for(const variant of variants){cursor+=variant.weight;if(point<cursor)return variant}
  return variants[variants.length-1]!;
}
