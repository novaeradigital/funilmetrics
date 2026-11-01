-- D-164: nome do kit comprado, gravado na venda (commerce_orders).
-- Preenchido pelo worker a partir do payload do ConfigCheckout
-- (order.kit.name); nulo para fontes sem kit. A base de vendas por
-- produto do Dashboard agrupa por coalesce(kit_name, produto).
alter table public.commerce_orders
  add column if not exists kit_name text;
