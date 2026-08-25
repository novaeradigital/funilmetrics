export function calendarDateInTimeZone(now:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:timeZone||"UTC",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(now);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftCalendarDate(value:string,days:number){
  const [year=1970,month=1,day=1]=value.split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day+days));
  return date.toISOString().slice(0,10);
}

export function calendarMonthStart(value:string){
  return `${value.slice(0,7)}-01`;
}

export function previousCalendarMonth(value:string){
  const currentStart=calendarMonthStart(value);
  const previousEnd=shiftCalendarDate(currentStart,-1);
  return {from:calendarMonthStart(previousEnd),to:previousEnd};
}

export function dashboardDatePreset(today:string,days:number){
  if(days===1){const yesterday=shiftCalendarDate(today,-1);return {from:yesterday,to:yesterday}}
  if(days>1)return {from:shiftCalendarDate(today,-(days-1)),to:today};
  if(days===-1)return {from:calendarMonthStart(today),to:today};
  if(days===-2)return previousCalendarMonth(today);
  return {from:today,to:today};
}
