import {describe,expect,it} from "vitest";import {detectMetricIntent} from "./metric-assistant";
describe("metric assistant intent",()=>{
 it("recognizes governed topics",()=>{
  expect(detectMetricIntent("Qual foi a receita líquida?")).toBe("revenue");
  expect(detectMetricIntent("Como está a cobertura de UTM?")).toBe("utm_coverage");
  expect(detectMetricIntent("Quantas vendas tivemos?")).toBe("sales");
  expect(detectMetricIntent("Mostre as campanhas da Meta")).toBe("campaigns");
 });
 it("refuses unsupported free-form analysis",()=>expect(detectMetricIntent("Quem devo contratar?")).toBe("unsupported"));
});
