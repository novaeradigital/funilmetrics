import {describe,expect,it} from "vitest";
import {metaSyncIdempotencyKey} from "./meta-sync-scheduler.js";

describe("metaSyncIdempotencyKey",()=>{
  it("é estável para a mesma agenda e instante",()=>{
    const scheduledFor=new Date("2026-07-25T22:30:00.000Z");
    expect(metaSyncIdempotencyKey("schedule-1",scheduledFor))
      .toBe("meta-sync:schedule-1:2026-07-25T22:30:00.000Z");
    expect(metaSyncIdempotencyKey("schedule-1",scheduledFor))
      .toBe(metaSyncIdempotencyKey("schedule-1",scheduledFor));
  });

  it("muda quando o instante planejado muda",()=>{
    expect(metaSyncIdempotencyKey("schedule-1",new Date("2026-07-25T22:30:00Z")))
      .not.toBe(metaSyncIdempotencyKey("schedule-1",new Date("2026-07-25T23:30:00Z")));
  });
});
