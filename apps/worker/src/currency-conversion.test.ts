import {describe,expect,it,vi} from "vitest";
import type pg from "pg";
import {BcbPtaxProvider,BCB_SOURCE,convertAmount,processCurrencyConversions} from "./currency-conversion.js";

const response=(value:unknown[],ok=true,status=200)=>
  Promise.resolve(new Response(JSON.stringify({value}),{status:ok?status:status||500,
    headers:{"content-type":"application/json"}}));
const quote=(date:string,value:number,type="Fechamento")=>({
  cotacaoVenda:value,dataHoraCotacao:`${date} 13:00:00.000`,tipoBoletim:type,
});

describe("convertAmount",()=>{
  it("mantém zero",()=>expect(convertAmount(0,5)).toBe(0));
  it("converte USD para BRL",()=>expect(convertAmount(10,5.25)).toBe(52.5));
  it("converte BRL para USD",()=>expect(convertAmount(52.5,1/5.25)).toBe(10));
  it("arredonda em seis casas",()=>expect(convertAmount(1,1/3)).toBe(0.333333));
  it("aceita valor financeiro grande",()=>expect(convertAmount(9_999_999.99,5)).toBe(49_999_999.95));
  it("preserva valor negativo de estorno",()=>expect(convertAmount(-10,5)).toBe(-50));
  it("rejeita taxa zero",()=>expect(()=>convertAmount(1,0)).toThrow("invalid_conversion_input"));
  it("rejeita taxa negativa",()=>expect(()=>convertAmount(1,-1)).toThrow("invalid_conversion_input"));
  it("rejeita valor não numérico",()=>expect(()=>convertAmount(Number.NaN,1)).toThrow("invalid_conversion_input"));
  it("rejeita taxa infinita",()=>expect(()=>convertAmount(1,Number.POSITIVE_INFINITY)).toThrow("invalid_conversion_input"));
});

describe("BcbPtaxProvider",()=>{
  it("suporta BRL sem chamada externa",async()=>{
    const http=vi.fn();expect(await new BcbPtaxProvider(http).supports("BRL")).toBe(true);
    expect(http).not.toHaveBeenCalled();
  });
  it("confirma moeda publicada pelo BCB",async()=>{
    const http=vi.fn(()=>response([{simbolo:"USD"}]));
    expect(await new BcbPtaxProvider(http).supports("USD")).toBe(true);
  });
  it("rejeita moeda ausente no catálogo",async()=>{
    const http=vi.fn(()=>response([]));
    expect(await new BcbPtaxProvider(http).supports("XYZ")).toBe(false);
  });
  it("retorna identidade na mesma moeda",async()=>{
    const http=vi.fn();const result=await new BcbPtaxProvider(http).rate("BRL","BRL","2026-07-31");
    expect(result).toEqual({rate:1,rateDate:"2026-07-31",source:BCB_SOURCE,sourceVersion:"v1"});
  });
  it("usa o fechamento do próprio dia útil",async()=>{
    const http=vi.fn((url:string)=>url.includes("Moedas")?response([{simbolo:"USD"}]):
      response([quote("2026-07-31",5.5)]));
    expect(await new BcbPtaxProvider(http).rate("USD","BRL","2026-07-31"))
      .toMatchObject({rate:5.5,rateDate:"2026-07-31"});
  });
  it("fim de semana usa último fechamento anterior",async()=>{
    const http=vi.fn((url:string)=>url.includes("Moedas")?response([{simbolo:"USD"}]):
      response([quote("2026-07-31",5.5)]));
    expect(await new BcbPtaxProvider(http).rate("USD","BRL","2026-08-02"))
      .toMatchObject({rate:5.5,rateDate:"2026-07-31"});
  });
  it("feriado usa último fechamento anterior",async()=>{
    const http=vi.fn((url:string)=>url.includes("Moedas")?response([{simbolo:"EUR"}]):
      response([quote("2026-04-20",6.2)]));
    expect(await new BcbPtaxProvider(http).rate("EUR","BRL","2026-04-21"))
      .toMatchObject({rate:6.2,rateDate:"2026-04-20"});
  });
  it("nunca escolhe cotação futura",async()=>{
    const http=vi.fn((url:string)=>url.includes("Moedas")?response([{simbolo:"USD"}]):
      response([quote("2026-08-03",5.6)]));
    expect(await new BcbPtaxProvider(http).rate("USD","BRL","2026-08-02")).toBeNull();
  });
  it("ignora boletim que não é fechamento",async()=>{
    const http=vi.fn((url:string)=>url.includes("Moedas")?response([{simbolo:"USD"}]):
      response([quote("2026-07-31",5.4,"Abertura")]));
    expect(await new BcbPtaxProvider(http).rate("USD","BRL","2026-07-31")).toBeNull();
  });
  it("conversão cruzada usa a mesma data comum",async()=>{
    let histories=0;
    const http=vi.fn((url:string)=>{
      if(url.includes("Moedas"))return response([{simbolo:"ok"}]);
      histories+=1;
      return histories===1?response([quote("2026-07-30",5),quote("2026-07-31",5.5)]):
        response([quote("2026-07-30",6.25)]);
    });
    const result=await new BcbPtaxProvider(http).rate("USD","EUR","2026-07-31");
    expect(result).toMatchObject({rate:0.8,rateDate:"2026-07-30"});
  });
});

describe("processCurrencyConversions",()=>{
  it("converte exclusivamente o valor original preservado",async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const pool={query:vi.fn(async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes("with target_project"))return {rows:[{
        id:"insight-1",organization_id:"org-1",project_id:"project-1",
        metric_date:"2026-07-31",spend_original:"10.25",currency:"USD",base_currency:"BRL",
      }]};
      if(sql.includes("insert into public.currency_conversion_runs"))return {rows:[{id:"run-1"}]};
      if(sql.includes("from public.exchange_rates"))return {rows:[]};
      return {rows:[]};
    })} as unknown as pg.Pool;
    const provider={
      supports:vi.fn(async()=>true),
      rate:vi.fn(async()=>({rate:5,rateDate:"2026-07-31",source:BCB_SOURCE,sourceVersion:"v1"})),
    };

    await expect(processCurrencyConversions(pool,provider,100)).resolves.toEqual({
      considered:1,converted:1,pending:0,failed:0,
    });
    const persisted=calls.find(call=>call.sql.includes("update public.meta_ad_insights_daily set original_currency"));
    expect(persisted?.values?.[2]).toBe(51.25);
  });

  it("remove todos os derivados quando a conversão falha",async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const pool={query:vi.fn(async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes("with target_project"))return {rows:[{
        id:"insight-2",organization_id:"org-1",project_id:"project-1",
        metric_date:"2026-07-31",spend_original:"10",currency:"USD",base_currency:"BRL",
      }]};
      if(sql.includes("insert into public.currency_conversion_runs"))return {rows:[{id:"run-2"}]};
      if(sql.includes("from public.exchange_rates"))return {rows:[]};
      return {rows:[]};
    })} as unknown as pg.Pool;
    const provider={supports:vi.fn(async()=>true),rate:vi.fn(async()=>{throw new Error("provider_down")})};

    await expect(processCurrencyConversions(pool,provider,100)).resolves.toEqual({
      considered:1,converted:0,pending:0,failed:1,
    });
    const blocked=calls.find(call=>call.sql.includes("exchange_rate_source=null"));
    expect(blocked?.sql).toContain("base_currency=null");
    expect(blocked?.values).toEqual(["insight-2","conversion_error","fx-v1-ptax-closing-sale","provider_down"]);
  });
});
