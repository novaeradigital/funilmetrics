import {describe,expect,it} from "vitest";
import {assign} from "./index";

const variants=[
 {id:"a",destinationUrl:"https://example.com/a",weight:70},
 {id:"b",destinationUrl:"https://example.com/b",weight:30},
];

describe("edge weighted assignment",()=>{
 it("is deterministic for the same visitor and experiment",async()=>{
  expect(await assign("visitor-1","experiment-1",variants))
   .toEqual(await assign("visitor-1","experiment-1",variants));
 });

 it("never returns a variant outside the configured set",async()=>{
  const selected=await Promise.all(Array.from({length:100},(_,index)=>
   assign(`visitor-${index}`,"experiment-1",variants)));
  expect(selected.every(item=>variants.some(variant=>variant.id===item.id))).toBe(true);
 });

 it("rejects an invalid weight total",async()=>{
  await expect(assign("visitor","experiment",[
   {id:"a",destinationUrl:"https://example.com",weight:0},
  ])).rejects.toThrow("invalid_weight");
 });
});
