import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMetaManagerColumns} from "./meta-manager-columns";

test("preserva todas as colunas governadas do gerenciador",()=>{
 assert.deepEqual(normalizeMetaManagerColumns([
  "name","reach","frequency","cpm","landing_page_views",
  "cost_per_landing_page_view","initiate_checkout","cost_per_initiate_checkout",
 ]),[
  "name","reach","frequency","cpm","landing_page_views",
  "cost_per_landing_page_view","initiate_checkout","cost_per_initiate_checkout",
 ]);
});

test("remove colunas desconhecidas e duplicadas",()=>{
 assert.deepEqual(normalizeMetaManagerColumns(["name","sql_livre","name","spend"]),["name","spend"]);
 assert.deepEqual(normalizeMetaManagerColumns("name"),[]);
});
