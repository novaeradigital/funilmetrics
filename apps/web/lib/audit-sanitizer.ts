const sensitive=/token|secret|password|authorization|credential|cookie|session|private[-_]?key|signing[-_]?key|api[-_]?key|access[-_]?key|refresh[-_]?token|client[-_]?secret/i;
export function sanitizeAuditValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(sanitizeAuditValue);
 if(value&&typeof value==="object"){
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>
   [key,sensitive.test(key)?"[REDACTED]":sanitizeAuditValue(item)]));
 }
 return value;
}
