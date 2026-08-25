import {describe,expect,it} from "vitest";
import {analysisCostBrl,transcriptionCostBrl} from "./ai-budget.js";

describe("custos de IA",()=>{
  it("calcula tokens por milhão sem arredondar o fato medido",()=>{
    expect(analysisCostBrl(500_000,250_000,2,8)).toBe(3);
  });
  it("calcula áudio por minuto proporcionalmente",()=>{
    expect(transcriptionCostBrl(90,0.4)).toBeCloseTo(0.6);
  });
});
