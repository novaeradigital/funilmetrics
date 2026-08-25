const processingLabels:Record<string,string>={
 received:"Recebido",queued:"Na fila",processing:"Processando",normalized:"Normalizado",
 duplicate:"Duplicado",quarantined:"Em quarentena",failed_retryable:"Falha recuperável",
 failed_terminal:"Falha terminal",
};
const validationLabels:Record<string,string>={
 pending:"Pendente",valid:"Válido",partial:"Parcial",invalid:"Inválido",
 unknown_event:"Evento desconhecido",
};
const errorLabels:Record<string,string>={
 invalid_json:"JSON inválido",
 invalid_envelope:"Estrutura principal inválida",
 unknown_event:"Evento ainda não suportado",
 minimum_data_missing:"Dados mínimos ausentes",
 preferred_fields_missing:"Campos recomendados ausentes",
 normalization_failed:"Falha temporária na normalização",
 normalization_attempts_exhausted:"Limite de tentativas atingido",
};

export function processingStatusLabel(status:string){
 return processingLabels[status]??"Estado não reconhecido";
}
export function validationStatusLabel(status:string){
 return validationLabels[status]??"Estado não reconhecido";
}
export function qualityErrorLabel(code:string|null){
 if(!code)return null;
 return errorLabels[code]??"Falha operacional registrada";
}
