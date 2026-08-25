import {isIP} from "node:net";

export function normalizeCustomDomain(input:string){
  try{
    const raw=input.trim().toLowerCase().replace(/\.$/,"");
    if(raw.includes(":")) return null;
    const url=new URL(`https://${raw}`);
    const hostname=url.hostname;
    if(
      url.port||
      url.pathname!=="/"||
      url.search||
      url.hash||
      hostname==="localhost"||
      isIP(hostname)!==0||
      !hostname.includes(".")||
      hostname.length>253||
      !/^[a-z0-9.-]+$/.test(hostname)||
      hostname.split(".").some((part)=>!part||part.length>63||part.startsWith("-")||part.endsWith("-"))
    ) return null;
    return hostname;
  }catch{
    return null;
  }
}

const customDomainStatusLabels:Record<string,string>={
  pending_dns:"Aguardando DNS",
  verified:"Propriedade confirmada",
  provisioning:"Provisionamento solicitado",
  active:"Ativo",
  error:"Falha operacional",
  disabled:"Desativado",
};

export function customDomainStatusLabel(status:string){
  return customDomainStatusLabels[status]??"Estado desconhecido";
}

export function customDomainErrorLabel(code:string|null){
  if(!code)return null;
  if(code==="dns_txt_missing")return "O registro TXT esperado ainda não foi encontrado.";
  if(code==="traffic_dns_missing")return "O CNAME ainda não aponta para o destino informado.";
  if(code==="provider_dns_missing")return "O TXT de verificação da Railway ainda não foi encontrado.";
  if(code==="tls_pending")return "O DNS está correto, mas o certificado HTTPS ainda está sendo emitido.";
  return "A última verificação não foi concluída. Tente novamente.";
}
