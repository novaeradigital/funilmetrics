import {describe,expect,it} from "vitest";import {sanitizeAuditValue} from "./audit-sanitizer";
describe("audit sanitizer",()=>{
 it("redacts secrets recursively and preserves operational context",()=>{
 expect(sanitizeAuditValue({provider:"meta",token:"abc",nested:{clientSecret:"xyz",status:"active"},
   entries:[{api_key:"key",count:2}],privateKey:"pem",credentials:{user:"x"},sessionCookie:"cookie"}))
   .toEqual({provider:"meta",token:"[REDACTED]",nested:{clientSecret:"[REDACTED]",status:"active"},
    entries:[{api_key:"[REDACTED]",count:2}],privateKey:"[REDACTED]",
    credentials:"[REDACTED]",sessionCookie:"[REDACTED]"});
 });
});
