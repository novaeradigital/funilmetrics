export type TrackingInput={
 externalEventId:string;eventType:string;visitorId?:string;sessionId?:string;
 occurredAt:string;pageUrl:string;referrer?:string;utm:Record<string,string>;
 properties:Record<string,string|number|boolean|null>;isBot:boolean;
 fbclid?:string;fbp?:string;fbc?:string;
};
export type TrackingContext={ip?:string;userAgent?:string};
export type TrackingSource={
 id:string;organization_id:string;project_id:string;allowed_origins:string[];
 business_project_id?:string|null;ic_trigger_type?:string|null;
 ic_trigger_value?:string|null;product_page?:boolean|null;
 pixel_id?:string|null;pixel_mode?:string|null;pixel_active?:boolean|null;
 pixel_config?:Record<string,unknown>|null;event_id_prefix?:string|null;
};
type Queryable={query:<T extends Record<string,unknown>>(sql:string,values?:unknown[])=>Promise<{rows:T[];rowCount:number|null}>};

const metaEventNames:Record<string,string>={
 page_view:"PageView",view_content:"ViewContent",initiate_checkout:"InitiateCheckout",
};
const metaEventConfigKeys:Record<string,string>={
 PageView:"pageView",ViewContent:"viewContent",InitiateCheckout:"initiateCheckout",
};

function metaCustomData(properties:Record<string,string|number|boolean|null>){
 const data:Record<string,unknown>={};
 const contentId=properties.contentId;
 if(typeof contentId==="string"&&contentId)data.content_ids=[contentId];
 if(typeof properties.contentName==="string"&&properties.contentName)data.content_name=properties.contentName;
 if(typeof properties.contentType==="string"&&properties.contentType)data.content_type=properties.contentType;
 else if(data.content_ids)data.content_type="product";
 if(typeof properties.value==="number"&&Number.isFinite(properties.value))data.value=properties.value;
 if(typeof properties.currency==="string"&&properties.currency)data.currency=properties.currency;
 return data;
}

export function createTrackingRepository(pool:Queryable){
 return {
  async findPublicSource(publicKey:string){
   return (await pool.query<TrackingSource>(`
    select s.id,s.organization_id,s.project_id,s.allowed_origins,
      s.business_project_id::text as business_project_id,s.ic_trigger_type,
      s.ic_trigger_value,s.product_page,
      p.pixel_id,p.mode as pixel_mode,p.active as pixel_active,
      p.config as pixel_config,p.event_id_prefix
      from public.tracking_sources s
      left join public.business_meta_pixels p
        on p.business_project_id=s.business_project_id and p.project_id=s.project_id
     where s.public_key=$1 and s.active=true`,[publicKey])).rows[0]??null;
  },
  async findSource(publicKey:string,origin:string|undefined){
   const row=await this.findPublicSource(publicKey);
   if(!row)return null;
   if(row.allowed_origins.length&&(!origin||!row.allowed_origins.includes(origin)))return null;
   return row;
  },
  async insert(source:TrackingSource,events:TrackingInput[],context:TrackingContext={}){
   let accepted=0,duplicates=0;
   const pixelReady=Boolean(source.pixel_id&&source.pixel_active&&
     (source.pixel_mode==="api"||source.pixel_mode==="both"));
   const pixelConfig=(source.pixel_config??{}) as {
     events?:Record<string,boolean>;blockIps?:string[];
   };
   for(const event of events){
    const result=await pool.query(`insert into public.tracking_events(organization_id,project_id,
     tracking_source_id,external_event_id,event_type,visitor_id,session_id,occurred_at,page_url,
     referrer,utm,properties,is_bot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
     on conflict(tracking_source_id,external_event_id) do nothing`,
     [source.organization_id,source.project_id,source.id,event.externalEventId,event.eventType,
      event.visitorId??null,event.sessionId??null,event.occurredAt,event.pageUrl,event.referrer??null,
      JSON.stringify(event.utm),JSON.stringify(event.properties),event.isBot]);
    if(result.rowCount)accepted++;else duplicates++;
    if(!result.rowCount)continue;
    if(event.visitorId){
     await pool.query(`insert into public.tracking_visitors(organization_id,project_id,
       tracking_source_id,visitor_id,fbp,fbc,fbclid,client_ip,user_agent,first_url,
       first_referrer,utm,first_seen_at,last_seen_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$13)
       on conflict(tracking_source_id,visitor_id) do update set
        fbp=coalesce(excluded.fbp,public.tracking_visitors.fbp),
        fbc=coalesce(excluded.fbc,public.tracking_visitors.fbc),
        fbclid=coalesce(excluded.fbclid,public.tracking_visitors.fbclid),
        client_ip=coalesce(excluded.client_ip,public.tracking_visitors.client_ip),
        user_agent=coalesce(excluded.user_agent,public.tracking_visitors.user_agent),
        last_seen_at=excluded.last_seen_at`,
      [source.organization_id,source.project_id,source.id,event.visitorId,
       event.fbp??null,event.fbc??null,event.fbclid??null,
       context.ip??null,context.userAgent??null,event.pageUrl,event.referrer??null,
       JSON.stringify(event.utm),event.occurredAt]);
    }
    const metaName=metaEventNames[event.eventType];
    if(pixelReady&&metaName&&source.business_project_id){
     const enabled=pixelConfig.events?.[metaEventConfigKeys[metaName]!];
     if(enabled!==false){
      const userData:Record<string,unknown>={};
      if(event.fbp)userData.fbp=event.fbp;
      if(event.fbc)userData.fbc=event.fbc;
      if(context.ip)userData.client_ip_address=context.ip;
      if(context.userAgent)userData.client_user_agent=context.userAgent;
      const blocked=Boolean(context.ip&&pixelConfig.blockIps?.includes(context.ip));
      await pool.query(`insert into public.meta_event_queue(organization_id,project_id,
        business_project_id,pixel_id,event_name,event_id,event_time,event_source_url,
        visitor_id,user_data,custom_data,status,blocked_reason)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)
        on conflict(pixel_id,event_id) do nothing`,
       [source.organization_id,source.project_id,source.business_project_id,
        source.pixel_id,metaName,event.externalEventId,event.occurredAt,event.pageUrl,
        event.visitorId??null,JSON.stringify(userData),
        JSON.stringify(metaCustomData(event.properties)),
        blocked?"blocked":"pending",blocked?"ip_excluido":null]);
     }
    }
   }
   return {accepted,duplicates};
  }
 };
}
export type TrackingRepository=ReturnType<typeof createTrackingRepository>;
