export type TrackingInput={
 externalEventId:string;eventType:string;visitorId?:string;sessionId?:string;
 occurredAt:string;pageUrl:string;referrer?:string;utm:Record<string,string>;
 properties:Record<string,string|number|boolean|null>;isBot:boolean;
};
type Queryable={query:<T extends Record<string,unknown>>(sql:string,values?:unknown[])=>Promise<{rows:T[];rowCount:number|null}>};
export function createTrackingRepository(pool:Queryable){
 return {
  async findPublicSource(publicKey:string){
   return (await pool.query<{id:string;organization_id:string;project_id:string;allowed_origins:string[]}>(`
    select id,organization_id,project_id,allowed_origins from public.tracking_sources
    where public_key=$1 and active=true`,[publicKey])).rows[0]??null;
  },
  async findSource(publicKey:string,origin:string|undefined){
   const row=await this.findPublicSource(publicKey);
   if(!row)return null;
   if(row.allowed_origins.length&&(!origin||!row.allowed_origins.includes(origin)))return null;
   return row;
  },
  async insert(source:{id:string;organization_id:string;project_id:string},events:TrackingInput[]){
   let accepted=0,duplicates=0;
   for(const event of events){
    const result=await pool.query(`insert into public.tracking_events(organization_id,project_id,
     tracking_source_id,external_event_id,event_type,visitor_id,session_id,occurred_at,page_url,
     referrer,utm,properties,is_bot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
     on conflict(tracking_source_id,external_event_id) do nothing`,
     [source.organization_id,source.project_id,source.id,event.externalEventId,event.eventType,
      event.visitorId??null,event.sessionId??null,event.occurredAt,event.pageUrl,event.referrer??null,
      JSON.stringify(event.utm),JSON.stringify(event.properties),event.isBot]);
    if(result.rowCount)accepted++;else duplicates++;
   }
   return {accepted,duplicates};
  }
 };
}
export type TrackingRepository=ReturnType<typeof createTrackingRepository>;
