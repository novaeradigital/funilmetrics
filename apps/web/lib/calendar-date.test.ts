import {describe,expect,it} from "vitest";
import {calendarDateInTimeZone,dashboardDatePreset,shiftCalendarDate} from "./calendar-date";

describe("datas civis do projeto",()=>{
  it("não vira o dia de São Paulo às 23h por causa do UTC",()=>{
    const instant=new Date("2026-08-03T02:00:00.000Z");
    expect(calendarDateInTimeZone(instant,"America/Sao_Paulo")).toBe("2026-08-02");
    expect(calendarDateInTimeZone(instant,"UTC")).toBe("2026-08-03");
  });

  it("vira o dia à meia-noite no fuso do projeto",()=>{
    const instant=new Date("2026-08-03T03:00:00.000Z");
    expect(calendarDateInTimeZone(instant,"America/Sao_Paulo")).toBe("2026-08-03");
  });

  it("calcula presets sem depender do fuso da máquina",()=>{
    expect(dashboardDatePreset("2026-08-02",0)).toEqual({from:"2026-08-02",to:"2026-08-02"});
    expect(dashboardDatePreset("2026-08-02",7)).toEqual({from:"2026-07-27",to:"2026-08-02"});
    expect(dashboardDatePreset("2026-08-02",-2)).toEqual({from:"2026-07-01",to:"2026-07-31"});
    expect(shiftCalendarDate("2026-03-01",-1)).toBe("2026-02-28");
  });
});
