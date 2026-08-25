import {describe,expect,it} from "vitest";
import {dashboardMetricCatalog,getDashboardMetric} from "./dashboard-metrics";

describe("dashboard metric catalog",()=>{
 it("mantém chaves únicas e versões explícitas",()=>{
  expect(new Set(dashboardMetricCatalog.map(metric=>metric.key)).size).toBe(dashboardMetricCatalog.length);
  expect(dashboardMetricCatalog.every(metric=>metric.ruleVersion.length>0)).toBe(true);
 });
 it("não inventa uma métrica ausente",()=>expect(getDashboardMetric("roas_causal")).toBeUndefined());
});
