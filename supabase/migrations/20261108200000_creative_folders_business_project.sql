-- Pastas de criativos ganham projeto de negocio (D-183): a organizacao
-- passa a ser Projeto, depois Pasta, depois Criativo. O criativo vale o
-- projeto proprio; sem ele, herda o da pasta.
alter table public.creative_folders
  add column if not exists business_project_id uuid
  references public.business_projects(id) on delete set null;

create index if not exists creative_folders_business_project_idx
  on public.creative_folders (business_project_id);

-- Preenche as pastas cujos criativos ja concordam num unico projeto.
update public.creative_folders folder
   set business_project_id = agreed.bp
  from (select folder_id, min(business_project_id::text)::uuid as bp
          from public.creatives
         where folder_id is not null and business_project_id is not null
         group by folder_id
        having count(distinct business_project_id) = 1) agreed
 where folder.id = agreed.folder_id
   and folder.business_project_id is null;
