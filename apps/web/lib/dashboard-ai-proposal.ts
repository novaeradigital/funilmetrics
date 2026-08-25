import {getDashboardMetric} from "./dashboard-metrics";

export type DashboardAiProposal={
 title:string;description:string;periodDays:7|30|90|365;
 widgets:Array<{title:string;type:"kpi"|"time_series"|"bar"|"donut"|"funnel"|"table"|"comparison";metric:string;width:number}>;
};

export function validateDashboardAiProposal(value:unknown):DashboardAiProposal{
 if(!value||typeof value!=="object")throw new Error("dashboard_ai_invalid");
 const row=value as Record<string,unknown>,title=String(row.title??"").trim();
 const description=String(row.description??"").trim(),periodDays=Number(row.periodDays);
 if(title.length<2||title.length>120||description.length>500||![7,30,90,365].includes(periodDays)
  ||!Array.isArray(row.widgets)||row.widgets.length<1||row.widgets.length>12)throw new Error("dashboard_ai_invalid");
 const allowedTypes=new Set(["kpi","time_series","bar","donut","funnel","table","comparison"]);
 const widgets=row.widgets.map((item)=>{
  if(!item||typeof item!=="object")throw new Error("dashboard_ai_invalid");
  const widget=item as Record<string,unknown>,widgetTitle=String(widget.title??"").trim();
  const type=String(widget.type??""),metric=String(widget.metric??""),width=Number(widget.width);
  if(widgetTitle.length<2||widgetTitle.length>120||!allowedTypes.has(type)||!getDashboardMetric(metric)
   ||![3,4,6,8,12].includes(width))throw new Error("dashboard_ai_invalid");
  return {title:widgetTitle,type:type as DashboardAiProposal["widgets"][number]["type"],metric,width};
 });
 return {title,description,periodDays:periodDays as DashboardAiProposal["periodDays"],widgets};
}
