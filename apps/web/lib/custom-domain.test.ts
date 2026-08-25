import {describe,expect,it} from "vitest";
import {customDomainErrorLabel,customDomainStatusLabel,normalizeCustomDomain} from "./custom-domain";

describe("normalizeCustomDomain",()=>{
  it("normaliza hostname válido sem aceitar URL completa",()=>{
    expect(normalizeCustomDomain(" Go.MinhaMarca.com. ")).toBe("go.minhamarca.com");
    expect(normalizeCustomDomain("https://go.minhamarca.com")).toBeNull();
  });

  it("recusa portas, caminhos, endereços IP e nomes locais",()=>{
    expect(normalizeCustomDomain("go.minhamarca.com:443")).toBeNull();
    expect(normalizeCustomDomain("go.minhamarca.com/campanha")).toBeNull();
    expect(normalizeCustomDomain("127.0.0.1")).toBeNull();
    expect(normalizeCustomDomain("localhost")).toBeNull();
  });

  it("recusa rótulos DNS inválidos",()=>{
    expect(normalizeCustomDomain("-go.minhamarca.com")).toBeNull();
    expect(normalizeCustomDomain("go..minhamarca.com")).toBeNull();
    expect(normalizeCustomDomain(`${"a".repeat(64)}.minhamarca.com`)).toBeNull();
  });
});

describe("rótulos operacionais de domínio",()=>{
  it("traduz estados conhecidos sem expor códigos internos",()=>{
    expect(customDomainStatusLabel("pending_dns")).toBe("Aguardando DNS");
    expect(customDomainStatusLabel("active")).toBe("Ativo");
    expect(customDomainStatusLabel("unexpected")).toBe("Estado desconhecido");
  });

  it("sanitiza falhas de verificação",()=>{
    expect(customDomainErrorLabel("dns_txt_missing")).toContain("TXT");
    expect(customDomainErrorLabel("internal_stack_value")).toBe(
      "A última verificação não foi concluída. Tente novamente.",
    );
    expect(customDomainErrorLabel(null)).toBeNull();
  });
});
