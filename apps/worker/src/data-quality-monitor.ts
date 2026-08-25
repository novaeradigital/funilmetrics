import type pg from "pg";

type ConnectionSignal = {
  organization_id: string;
  project_id: string;
  connection_id: string;
  failed_events: number;
  quarantined_events: number;
  stalled_events: number;
};

type IssueDefinition = {
  type: string;
  severity: "critical" | "warning";
  title: string;
  count: number;
};

export type DataQualityMonitorResult = {
  connectionsChecked: number;
  issuesDetected: number;
  issuesResolved: number;
};

const RULE_VERSION = "data_quality_v2";

export async function evaluateDataQuality(
  pool: pg.Pool,
): Promise<DataQualityMonitorResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const signals = await client.query<ConnectionSignal>(
      `select connection.organization_id,
              connection.project_id,
              connection.id as connection_id,
              count(event.id) filter (
                where event.processing_status in ('failed_retryable','failed_terminal')
              )::int as failed_events,
              count(event.id) filter (
                where event.processing_status = 'quarantined'
              )::int as quarantined_events,
              count(event.id) filter (
                where event.processing_status in ('received','queued','processing')
                  and event.received_at < now() - interval '10 minutes'
              )::int as stalled_events
         from public.connections connection
         left join public.raw_events event on event.connection_id = connection.id
        where connection.provider = 'lastlink'
        group by connection.id`,
    );

    let detected = 0;
    let resolved = 0;
    for (const signal of signals.rows) {
      const definitions: IssueDefinition[] = [
        {
          type: "processing_failure",
          severity: "critical",
          title: "Falhas no processamento da Lastlink",
          count: signal.failed_events,
        },
        {
          type: "quarantined_event",
          severity: "warning",
          title: "Eventos da Lastlink em quarentena",
          count: signal.quarantined_events,
        },
        {
          type: "stalled_backlog",
          severity: "warning",
          title: "Fila da Lastlink parada há mais de 10 minutos",
          count: signal.stalled_events,
        },
      ];
      for (const definition of definitions) {
        const issueKey = `lastlink:${signal.connection_id}:${definition.type}`;
        if (definition.count > 0) {
          detected += 1;
          await client.query(
            `insert into public.data_quality_issues (
               organization_id, project_id, connection_id, issue_key,
               issue_type, severity, title, evidence, rule_version
             ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
             on conflict (project_id, issue_key) where status = 'open'
             do update set
               evidence = excluded.evidence,
               severity = excluded.severity,
               title = excluded.title,
               last_detected_at = now(),
               occurrences = data_quality_issues.occurrences + 1`,
            [
              signal.organization_id,
              signal.project_id,
              signal.connection_id,
              issueKey,
              definition.type,
              definition.severity,
              definition.title,
              JSON.stringify({ count: definition.count }),
              RULE_VERSION,
            ],
          );
        } else {
          const resolution = await client.query(
            `update public.data_quality_issues
                set status = 'resolved', resolved_at = now()
              where project_id = $1
                and issue_key = $2
                and status = 'open'`,
            [signal.project_id, issueKey],
          );
          resolved += resolution.rowCount ?? 0;
        }
      }
    }
    const operational=await client.query<{
      organization_id:string;project_id:string;drive_overdue:number;
      meta_reconciliation:number;meta_sync_overdue:number;
      meta_sync_failed:number;meta_sync_stalled:number;currency_unconfirmed:number;
      currency_conversion_blocked:number;
    }>(
      `select project.organization_id,project.id project_id,
       (select count(*)::int from public.drive_sync_schedules schedule
         where schedule.project_id=project.id and schedule.enabled
           and schedule.next_run_at<now()-interval '15 minutes') drive_overdue,
       (select count(*)::int from public.meta_publication_executions execution
         where execution.project_id=project.id
           and execution.status='reconciliation_required') meta_reconciliation,
       (select count(*)::int from public.meta_sync_schedules schedule
         where schedule.project_id=project.id and schedule.enabled
           and schedule.next_run_at<now()-interval '15 minutes') meta_sync_overdue,
       (select count(*)::int from public.connections connection
         join lateral(
           select run.status from public.meta_sync_runs run
            where run.connection_id=connection.id
            order by run.created_at desc limit 1
         ) latest on true
         where connection.project_id=project.id and connection.provider='meta_ads'
           and latest.status='failed_terminal') meta_sync_failed,
       (select count(*)::int from public.meta_sync_runs run
         where run.project_id=project.id and (
           (run.status='failed_retryable'
             and run.next_attempt_at<now()-interval '5 minutes')
           or (run.status in ('queued','running')
             and run.updated_at<now()-interval '30 minutes')
         )) meta_sync_stalled,
       (select count(*)::int from public.meta_ad_accounts account
         where account.project_id=project.id and account.currency_status='unconfirmed') currency_unconfirmed,
       (select count(*)::int from public.meta_ad_insights_daily insight
         where insight.project_id=project.id and insight.conversion_status in
           ('pending_rate','missing_currency','unsupported_currency','conversion_error')) currency_conversion_blocked
       from public.projects project`,
    );
    for(const signal of operational.rows){
      for(const definition of [
        {type:"drive_sync_overdue",severity:"warning",title:"Sincronização do Drive atrasada",count:signal.drive_overdue},
        {type:"meta_reconciliation_required",severity:"critical",title:"Publicação Meta exige reconciliação",count:signal.meta_reconciliation},
        {type:"meta_sync_overdue",severity:"warning",title:"Agenda Meta atrasada",count:signal.meta_sync_overdue},
        {type:"meta_sync_failed",severity:"critical",title:"Sincronização Meta com falha terminal",count:signal.meta_sync_failed},
        {type:"meta_sync_stalled",severity:"warning",title:"Fila de sincronização Meta parada",count:signal.meta_sync_stalled},
        {type:"currency_unconfirmed",severity:"critical",title:"Conta de anúncios sem moeda confirmada",count:signal.currency_unconfirmed},
        {type:"currency_conversion_blocked",severity:"warning",title:"Gastos bloqueados por conversão cambial",count:signal.currency_conversion_blocked},
      ] as const){
        const issueKey=`project:${signal.project_id}:${definition.type}`;
        if(definition.count>0){
          detected+=1;
          await client.query(
            `insert into public.data_quality_issues(organization_id,project_id,
             issue_key,issue_type,severity,title,evidence,rule_version)
             values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
             on conflict(project_id,issue_key) where status='open' do update set
             evidence=excluded.evidence,last_detected_at=now(),
             occurrences=data_quality_issues.occurrences+1`,
            [signal.organization_id,signal.project_id,issueKey,definition.type,
             definition.severity,definition.title,JSON.stringify({count:definition.count}),RULE_VERSION],
          );
        }else{
          const result=await client.query(`update public.data_quality_issues
            set status='resolved',resolved_at=now() where project_id=$1
            and issue_key=$2 and status='open'`,[signal.project_id,issueKey]);
          resolved+=result.rowCount??0;
        }
      }
    }
    const anomalies=await client.query<{
      organization_id:string;
      project_id:string;
      current_orders:number;
      baseline_daily_average:string;
      baseline_days:number;
    }>(
      `select project.organization_id, project.id project_id,
              count(distinct current_order.id)::int current_orders,
              coalesce(baseline.daily_average, 0)::text baseline_daily_average,
              coalesce(baseline.observed_days, 0)::int baseline_days
         from public.projects project
         left join public.commerce_orders current_order
           on current_order.project_id = project.id
          and current_order.data_scope = 'production'
          and current_order.occurred_at >= now() - interval '24 hours'
         left join lateral (
           select avg(day_total)::numeric daily_average,
                  count(*)::int observed_days
             from (
               select date_trunc('day', historical.occurred_at) as "day",
                      count(distinct historical.id)::numeric day_total
                 from public.commerce_orders historical
                where historical.project_id = project.id
                  and historical.data_scope = 'production'
                  and historical.occurred_at < now() - interval '24 hours'
                  and historical.occurred_at >= now() - interval '8 days'
                group by date_trunc('day', historical.occurred_at)
             ) daily
         ) baseline on true
        group by project.id, baseline.daily_average, baseline.observed_days`,
    );
    for (const signal of anomalies.rows) {
      const average=Number(signal.baseline_daily_average);
      const sufficientBaseline=signal.baseline_days>=4 && average>=3;
      const factor=average>0 ? signal.current_orders/average : 0;
      const detectedNow=sufficientBaseline && signal.current_orders>=10 && factor>=3;
      const issueKey=`project:${signal.project_id}:sales_volume_anomaly`;
      if (detectedNow) {
        detected+=1;
        await client.query(
          `insert into public.data_quality_issues (
             organization_id,project_id,issue_key,issue_type,severity,title,
             evidence,rule_version
           ) values ($1,$2,$3,'sales_volume_anomaly','info',
                     'Volume de pedidos acima do padrão recente',$4::jsonb,$5)
           on conflict(project_id,issue_key) where status='open' do update set
             evidence=excluded.evidence,last_detected_at=now(),
             occurrences=data_quality_issues.occurrences+1`,
          [
            signal.organization_id,
            signal.project_id,
            issueKey,
            JSON.stringify({
              currentOrders:signal.current_orders,
              baselineDailyAverage:Number(average.toFixed(2)),
              baselineObservedDays:signal.baseline_days,
              factor:Number(factor.toFixed(2)),
              comparison:"rolling_24h_vs_previous_7_observed_days",
            }),
            "sales_volume_anomaly_v1",
          ],
        );
      } else {
        const result=await client.query(
          `update public.data_quality_issues
              set status='resolved',resolved_at=now()
            where project_id=$1 and issue_key=$2 and status='open'`,
          [signal.project_id,issueKey],
        );
        resolved+=result.rowCount??0;
      }
    }
    await client.query("commit");
    return {
      connectionsChecked: signals.rows.length,
      issuesDetected: detected,
      issuesResolved: resolved,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
