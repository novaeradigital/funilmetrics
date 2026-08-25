import {describe,expect,it} from "vitest";
import {wilsonInterval} from "./experiment-statistics";
describe("Wilson interval",()=>{
  it("returns a bounded interval",()=>{const result=wilsonInterval(50,100);
    expect(result.lower).toBeGreaterThan(0.4);expect(result.upper).toBeLessThan(0.6);});
  it("handles no observations",()=>expect(wilsonInterval(0,0)).toEqual({lower:0,upper:0}));
});
