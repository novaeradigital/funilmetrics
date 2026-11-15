-- D-196: multiplos gatilhos de InitiateCheckout por fonte, com rotulo por oferta.
-- A lista vive em ic_triggers (jsonb): [{type, value, label}] na ordem de avaliacao.
-- Backfill: o gatilho unico atual de cada fonte vira a regra numero 1, rotulo vazio,
-- sem mudanca de comportamento. As colunas legadas ic_trigger_type/ic_trigger_value
-- sao mantidas e passam a espelhar a primeira regra a cada salvamento.
alter table public.tracking_sources
  add column if not exists ic_triggers jsonb not null default '[]'::jsonb;

update public.tracking_sources
   set ic_triggers = jsonb_build_array(jsonb_build_object(
     'type', coalesce(ic_trigger_type, 'attribute'),
     'value', ic_trigger_value,
     'label', ''))
 where ic_triggers = '[]'::jsonb;
