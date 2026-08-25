import {describe,expect,it,vi} from "vitest";import {buildApp} from "../../app.js";
const source={id:"11111111-1111-4111-8111-111111111111",
 organization_id:"22222222-2222-4222-8222-222222222222",
 project_id:"33333333-3333-4333-8333-333333333333",allowed_origins:["https://example.com"]};
describe("first party tracking",()=>{
 it("serves the public script without relying on a Referer header",async()=>{
  const findPublicSource=vi.fn().mockResolvedValue(source);
  const app=buildApp({trackingRepository:{findPublicSource,
   findSource:vi.fn().mockResolvedValue(null),
   insert:vi.fn().mockResolvedValue({accepted:0,duplicates:0})}});
  const response=await app.inject({method:"GET",url:`/track/v1/${source.id}/script.js`});
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/javascript");
  expect(findPublicSource).toHaveBeenCalledWith(source.id);
  await app.close();
 });
 it("accepts and deduplicates a governed event",async()=>{
  const insert=vi.fn().mockResolvedValue({accepted:1,duplicates:0});
  const app=buildApp({trackingRepository:{findPublicSource:vi.fn(),findSource:vi.fn().mockResolvedValue(source),insert}});
  const response=await app.inject({method:"POST",url:`/track/v1/${source.id}/events`,
   headers:{origin:"https://example.com"},payload:{events:[{eventId:"event-0001",
    type:"video_play",occurredAt:"2026-07-26T12:00:00.000Z",pageUrl:"https://example.com/vsl"}]}});
  expect(response.statusCode).toBe(202);expect(insert).toHaveBeenCalledOnce();await app.close();
 });
 it("rejects unknown event types",async()=>{
  const app=buildApp({trackingRepository:{findPublicSource:vi.fn(),findSource:vi.fn().mockResolvedValue(source),
   insert:vi.fn().mockResolvedValue({accepted:0,duplicates:0})}});
  const response=await app.inject({method:"POST",url:`/track/v1/${source.id}/events`,
   payload:{events:[{eventId:"event-0001",type:"password_captured",
    occurredAt:"2026-07-26T12:00:00.000Z",pageUrl:"https://example.com"}]}});
  expect(response.statusCode).toBe(400);await app.close();
 });
});
