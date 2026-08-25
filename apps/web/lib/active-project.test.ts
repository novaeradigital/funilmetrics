import {describe,expect,it} from "vitest";
import {resolveProjectSelection} from "./project-selection";

const project=(id:string,organization_id="org-1")=>({
 id,organization_id,name:`Projeto ${id}`,slug:id,organization_name:"Organização",
 timezone:"America/Sao_Paulo",currency:"BRL",role:"viewer",
});

describe("resolveProjectSelection",()=>{
 it("distingue o estado sem projeto",()=>{
  expect(resolveProjectSelection([])).toEqual({project:null,selection:"none"});
 });
 it("seleciona automaticamente o único projeto permitido sem cookie",()=>{
  expect(resolveProjectSelection([project("a")])).toMatchObject({project:{id:"a"},selection:"automatic"});
 });
 it("mantém a seleção persistida entre vários projetos permitidos",()=>{
  expect(resolveProjectSelection([project("a"),project("b")],"b"))
   .toMatchObject({project:{id:"b"},selection:"selected"});
 });
 it("não substitui silenciosamente um projeto sem permissão",()=>{
  expect(resolveProjectSelection([project("a")],"restrito"))
   .toEqual({project:null,selection:"forbidden"});
 });
 it("não mistura organizações ao resolver um id permitido",()=>{
  const selected=resolveProjectSelection([project("a"),project("b","org-2")],"b");
  expect(selected.project?.organization_id).toBe("org-2");
 });
});
