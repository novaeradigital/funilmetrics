import {createDecipheriv} from "node:crypto";
import pg from "pg";

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 ssl:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED==="false"?
  {rejectUnauthorized:false}:undefined});
const row=(await pool.query(`
 select secret.ciphertext,secret.initialization_vector,secret.authentication_tag
 from public.integration_secrets secret
 where secret.provider='railway' and secret.kind='credential_bundle'
  and secret.rotated_at is null order by secret.created_at desc limit 1`)).rows[0];
const key=Buffer.from(process.env.INTEGRATION_SECRET_ENCRYPTION_KEY??"","base64");
if(!row||key.length!==32)throw new Error("railway_credentials_missing");
const decipher=createDecipheriv("aes-256-gcm",key,row.initialization_vector);
decipher.setAuthTag(row.authentication_tag);
const secret=JSON.parse(Buffer.concat([
 decipher.update(row.ciphertext),decipher.final()]).toString("utf8"));
const response=await fetch("https://backboard.railway.com/graphql/v2",{
 method:"POST",headers:{Authorization:`Bearer ${secret.apiToken}`,
  "Content-Type":"application/json"},
 body:JSON.stringify({query:`query MutationNames {
  __schema { mutationType { fields { name args { name type { kind name ofType { kind name } } } } } }
 }`})});
const body=await response.json();
const fields=body.data?.__schema?.mutationType?.fields??[];
console.log(JSON.stringify(fields.filter(field=>
 /domain/i.test(field.name)&&/(delete|remove)/i.test(field.name))));
await pool.end();
