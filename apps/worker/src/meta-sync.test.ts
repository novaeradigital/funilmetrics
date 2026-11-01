import {describe,expect,it} from "vitest";
import {metaInsightTimeRange,parseMetaVideoMetrics} from "./meta-sync.js";

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

describe("parseMetaVideoMetrics",()=>{
  it("extracts thruplay and retention from watched actions and 3s views from actions",()=>{
    expect(parseMetaVideoMetrics({
      actions:[{action_type:"link_click",value:"40"},{action_type:"video_view",value:"1200"}],
      video_thruplay_watched_actions:[{action_type:"video_view",value:"700"}],
      video_p25_watched_actions:[{action_type:"video_view",value:"900"}],
      video_p50_watched_actions:[{action_type:"video_view",value:"820"}],
      video_p75_watched_actions:[{action_type:"video_view",value:"760"}],
      video_p100_watched_actions:[{action_type:"video_view",value:"640"}],
    })).toEqual({views3s:1200,thruplay:700,p25:900,p50:820,p75:760,p100:640});
  });

  it("returns null for every metric when the insight has no video data",()=>{
    expect(parseMetaVideoMetrics({actions:[{action_type:"link_click",value:"3"}]}))
      .toEqual({views3s:null,thruplay:null,p25:null,p50:null,p75:null,p100:null});
  });

  it("sums repeated entries and ignores malformed values",()=>{
    expect(parseMetaVideoMetrics({
      actions:[{action_type:"video_view",value:"10"},{action_type:"video_view",value:"5"}],
      video_p75_watched_actions:[{action_type:"video_view",value:"abc"}],
    })).toEqual({views3s:15,thruplay:null,p25:null,p50:null,p75:null,p100:null});
  });
});
