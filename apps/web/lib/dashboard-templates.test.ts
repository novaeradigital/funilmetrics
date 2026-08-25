import {describe,expect,it} from "vitest";
import {dashboardTemplates} from "./dashboard-templates";
import {getDashboardMetric} from "./dashboard-metrics";

describe("dashboard templates",()=>{
 it("usa somente métricas governadas e larguras válidas",()=>{
  for(const template of dashboardTemplates)for(const widget of template.widgets){
   expect(getDashboardMetric(widget.metric)).toBeDefined();
   expect(widget.width).toBeGreaterThanOrEqual(1);
   expect(widget.width).toBeLessThanOrEqual(12);
  }
 });
});
