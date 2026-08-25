import {describe,expect,it} from "vitest";
import {processingStatusLabel,qualityErrorLabel,validationStatusLabel} from "./data-quality-labels";

describe("rótulos de qualidade",()=>{
 it("traduz processamento e validação",()=>{
  expect(processingStatusLabel("failed_retryable")).toBe("Falha recuperável");
  expect(validationStatusLabel("unknown_event")).toBe("Evento desconhecido");
 });
 it("não expõe estados internos desconhecidos",()=>{
  expect(processingStatusLabel("internal_state")).toBe("Estado não reconhecido");
  expect(validationStatusLabel("internal_state")).toBe("Estado não reconhecido");
 });
 it("sanitiza códigos de erro",()=>{
  expect(qualityErrorLabel("normalization_failed")).toContain("temporária");
  expect(qualityErrorLabel("postgres_secret_detail")).toBe("Falha operacional registrada");
  expect(qualityErrorLabel(null)).toBeNull();
 });
});
