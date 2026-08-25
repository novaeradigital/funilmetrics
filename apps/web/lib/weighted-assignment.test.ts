import {describe,expect,it} from "vitest";
import {assignWeighted} from "./weighted-assignment";
describe("weighted assignment",()=>{
  it("is deterministic",()=>{const variants=[{id:"a",weight:50},{id:"b",weight:50}];
    expect(assignWeighted("visitor","experiment",variants))
      .toEqual(assignWeighted("visitor","experiment",variants));});
  it("never selects zero ranges",()=>expect(assignWeighted("v","e",[{id:"only",weight:100}]).id).toBe("only"));
});
