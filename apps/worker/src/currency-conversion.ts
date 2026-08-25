import type pg from "pg";

export const CURRENCY_RULE_VERSION="fx-v1-ptax-closing-sale";
export const BCB_SOURCE="bcb-ptax";
export const BCB_SOURCE_VERSION="v1";

export type ConversionStatus="converted"|"pending_rate"|"missing_currency"|
  "unsupported_currency"|"conversion_error"|"not_required";
export type RateResult={rate:number;rateDate:string;source:string;sourceVersion:string};
export interface ExchangeRateProvider{
  supports(currency:string):Promise<boolean>;
  rate(from:string,to:string,onOrBefore:string):Promise<RateResult|null>;
}
type HttpClient=(input:string,init?:RequestInit)=>Promise<Response>;

type BcbQuote={cotacaoVenda?:number;dataHoraCotacao?:string;tipoBoletim?:string};
function isoDate(value:string){return value.slice(0,10)}
function bcbDate(value:string){const [year,month,day]=value.split("-");return `${month}-${day}-${year}`}
function minusDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10)}

export class BcbPtaxProvider implements ExchangeRateProvider{
  constructor(private readonly http:HttpClient=fetch){}
  async supports(currency:string){
    if(currency==="BRL")return true;
    const url="https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"+
      `Moedas?$filter=simbolo%20eq%20'${encodeURIComponent(currency)}'&$format=json`;
    const response=await this.http(url,{signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`fx_provider_http_${response.status}`);
    const payload=await response.json() as {value?:unknown[]};return Boolean(payload.value?.length);
  }
  private async history(currency:string,onOrBefore:string){
    if(currency==="BRL")return new Map([[onOrBefore,1]]);
    const start=minusDays(onOrBefore,10);
    const operation="CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
    const query=`@moeda='${currency}'&@dataInicial='${bcbDate(start)}'&@dataFinalCotacao='${bcbDate(onOrBefore)}'&$format=json`;
    const response=await this.http(`https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/${operation}?${encodeURI(query)}`,
      {signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`fx_provider_http_${response.status}`);
    const payload=await response.json() as {value?:BcbQuote[]};const result=new Map<string,number>();
    for(const quote of payload.value??[]){
      if(!quote.dataHoraCotacao||!Number.isFinite(Number(quote.cotacaoVenda)))continue;
      if(quote.tipoBoletim&&quote.tipoBoletim!=="Fechamento")continue;
      result.set(isoDate(quote.dataHoraCotacao),Number(quote.cotacaoVenda));
    }
    return result;
  }
  async rate(from:string,to:string,onOrBefore:string):Promise<RateResult|null>{
    if(from===to)return {rate:1,rateDate:onOrBefore,source:BCB_SOURCE,sourceVersion:BCB_SOURCE_VERSION};
    if(!(await this.supports(from))||!(await this.supports(to)))return null;
    const [fromHistory,toHistory]=await Promise.all([this.history(from,onOrBefore),this.history(to,onOrBefore)]);
    if(to==="BRL"){
      const date=[...fromHistory.keys()].filter(item=>item<=onOrBefore).sort().at(-1);
      const rate=date?fromHistory.get(date):null;
      return date&&rate?{rate,rateDate:date,source:BCB_SOURCE,sourceVersion:BCB_SOURCE_VERSION}:null;
    }
    if(from==="BRL"){
      const date=[...toHistory.keys()].filter(item=>item<=onOrBefore).sort().at(-1);
      const rate=date?toHistory.get(date):null;
      return date&&rate?{rate:1/rate,rateDate:date,source:BCB_SOURCE,sourceVersion:BCB_SOURCE_VERSION}:null;
    }
    const common=[...fromHistory.keys()].filter(date=>toHistory.has(date)&&date<=onOrBefore).sort().at(-1);
    if(!common)return null;
    const fromBrl=fromHistory.get(common),toBrl=toHistory.get(common);
    if(!fromBrl||!toBrl)return null;
    return {rate:fromBrl/toBrl,rateDate:common,source:BCB_SOURCE,sourceVersion:BCB_SOURCE_VERSION};
  }
}

export function convertAmount(amount:number,rate:number){
  if(!Number.isFinite(amount)||!Number.isFinite(rate)||rate<=0)throw new Error("invalid_conversion_input");
  return Math.round((amount*rate+Number.EPSILON)*1_000_000)/1_000_000;
}

type PendingRow={id:string;organization_id:string;project_id:string;metric_date:string;
  spend_original:string;currency:string|null;base_currency:string};

export async function processCurrencyConversions(pool:pg.Pool,provider:ExchangeRateProvider=new BcbPtaxProvider(),limit=100){
  const rows=(await pool.query<PendingRow>(`with target_project as (
    select project_id from public.meta_ad_insights_daily
    where conversion_status in ('pending_rate','missing_currency','conversion_error')
      and spend_original is not null
    order by metric_date,id limit 1
  ) select insight.id,insight.organization_id,insight.project_id,
    insight.metric_date::text,insight.spend_original::text,
    coalesce(nullif(insight.original_currency,''),nullif(insight.currency,'')) currency,
    project.currency base_currency from public.meta_ad_insights_daily insight join public.projects project on project.id=insight.project_id
    where insight.conversion_status in ('pending_rate','missing_currency','conversion_error')
      and insight.spend_original is not null
      and insight.project_id=(select project_id from target_project)
    order by insight.metric_date,insight.id limit $1`,[limit])).rows;
  if(!rows.length)return {considered:0,converted:0,pending:0,failed:0};
  const run=(await pool.query<{id:string}>(`insert into public.currency_conversion_runs(
    organization_id,project_id,status,trigger_kind,rule_version,started_at)
    values($1,$2,'running','retry',$3,now()) returning id`,[rows[0]!.organization_id,rows[0]!.project_id,CURRENCY_RULE_VERSION])).rows[0];
  let converted=0,pending=0,failed=0;
  for(const row of rows){
    const source=row.currency?.toUpperCase()??"",target=row.base_currency.toUpperCase();
    try{
      if(!source){await mark(pool,row.id,"missing_currency");pending+=1;continue}
      if(source===target){await persist(pool,row,source,target,1,row.metric_date,"not_required");converted+=1;continue}
      if(!(await provider.supports(source))||!(await provider.supports(target))){await mark(pool,row.id,"unsupported_currency");pending+=1;continue}
      const rate=await loadOrFetchRate(pool,provider,source,target,row.metric_date);
      if(!rate){await mark(pool,row.id,"pending_rate");pending+=1;continue}
      await persist(pool,row,source,target,rate.rate,rate.rateDate,"converted",rate);converted+=1;
    }catch(error){await mark(pool,row.id,"conversion_error",error instanceof Error?error.message:"conversion_error");failed+=1}
  }
  if(run)await pool.query(`update public.currency_conversion_runs set status=$2,rows_considered=$3,
    rows_converted=$4,rows_pending=$5,rows_failed=$6,completed_at=now(),updated_at=now() where id=$1`,
    [run.id,failed||pending?"partial":"completed",rows.length,converted,pending,failed]);
  return {considered:rows.length,converted,pending,failed};
}

async function loadOrFetchRate(pool:pg.Pool,provider:ExchangeRateProvider,from:string,to:string,date:string){
  const stored=(await pool.query<RateResult & {rate:string;rateDate:string}>(`select rate::text rate,
    source_rate_date::text "rateDate",source,source_version "sourceVersion" from public.exchange_rates
    where from_currency=$1 and to_currency=$2 and rate_date=$3 and source=$4 and rule_version=$5 limit 1`,
    [from,to,date,BCB_SOURCE,CURRENCY_RULE_VERSION])).rows[0];
  if(stored)return {...stored,rate:Number(stored.rate)};
  const fetched=await provider.rate(from,to,date);if(!fetched)return null;
  await pool.query(`insert into public.exchange_rates(rate_date,from_currency,to_currency,rate,source,
    source_version,rule_version,source_rate_date,source_reference) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    on conflict(rate_date,from_currency,to_currency,source,source_version,rule_version) do nothing`,
    [date,from,to,fetched.rate,fetched.source,fetched.sourceVersion,CURRENCY_RULE_VERSION,fetched.rateDate,
     JSON.stringify({policy:"latest_closing_rate_on_or_before",requestedDate:date})]);
  return fetched;
}

async function persist(pool:pg.Pool,row:PendingRow,source:string,target:string,rate:number,rateDate:string,
 status:ConversionStatus,metadata?:RateResult){
  await pool.query(`update public.meta_ad_insights_daily set original_currency=$2,
    spend_base=$3,base_currency=$4,exchange_rate=$5,exchange_rate_date=$6,
    exchange_rate_source=$7,exchange_rate_source_version=$8,conversion_rule_version=$9,
    conversion_status=$10,conversion_error_code=null,converted_at=now(),updated_at=now() where id=$1`,
    [row.id,source,convertAmount(Number(row.spend_original),rate),target,rate,rateDate,
     metadata?.source??"identity",metadata?.sourceVersion??CURRENCY_RULE_VERSION,CURRENCY_RULE_VERSION,status]);
}
async function mark(pool:pg.Pool,id:string,status:ConversionStatus,errorCode?:string){
  await pool.query(`update public.meta_ad_insights_daily set
    original_currency=coalesce(nullif(original_currency,''),nullif(currency,'')),spend_base=null,exchange_rate=null,
    base_currency=null,exchange_rate_date=null,exchange_rate_source=null,
    exchange_rate_source_version=null,conversion_rule_version=$3,conversion_status=$2,conversion_error_code=$4,
    converted_at=null,updated_at=now() where id=$1`,[id,status,CURRENCY_RULE_VERSION,errorCode?.slice(0,120)??null]);
}
