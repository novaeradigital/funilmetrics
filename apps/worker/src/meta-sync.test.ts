import {describe,expect,it} from "vitest";
import {metaInsightTimeRange} from "./meta-sync.js";

describe("metaInsightTimeRange",()=>{
  it("includes the current calendar day in the ad account timezone",()=>{
    expect(metaInsightTimeRange(
      new Date("2026-08-02T02:30:00.000Z"),"America/Sao_Paulo",30,
    )).toEqual({since:"2026-07-03",until:"2026-08-01"});
  });

  it("uses the provider timezone instead of the worker timezone",()=>{
    expect(metaInsightTimeRange(
      new Date("2026-08-02T02:30:00.000Z"),"Asia/Tokyo",30,
    )).toEqual({since:"2026-07-04",until:"2026-08-02"});
  });

  it("handles month and year boundaries",()=>{
    expect(metaInsightTimeRange(
      new Date("2027-01-01T15:00:00.000Z"),"UTC",7,
    )).toEqual({since:"2026-12-26",until:"2027-01-01"});
  });
});
