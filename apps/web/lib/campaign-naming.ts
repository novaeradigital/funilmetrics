// Motor de nomenclatura e UTMs do modulo Campanhas (D-171).
// Resolve variaveis {criativo}, {pasta}, {produto}, {data}, {sequencia},
// {formato}, {conta}, {pagina}, {pais}, {objetivo}, {publico},
// {orcamento} e texto livre, com separador e caixa configuraveis.
// Cada variavel pode ter fonte de arquivo: um mapa chave -> valor vindo
// de um arquivo de referencia da Biblioteca.

export type NamingContext = {
  criativo?: string;
  pasta?: string;
  produto?: string;
  data?: Date;
  sequencia?: number;
  formato?: string;
  conta?: string;
  pagina?: string;
  pais?: string;
  objetivo?: string;
  publico?: string;
  orcamento?: string | number;
  arquivo?: Record<string, string>;
};

export type NamingOptions = {
  separator?: string;
  casing?: "original" | "upper" | "lower";
  dateFormat?: "YYYYMMDD" | "DDMMYYYY" | "YYYY-MM-DD" | "DD/MM/YYYY";
};

const KNOWN_VARIABLES = [
  "criativo", "pasta", "produto", "data", "sequencia", "formato",
  "conta", "pagina", "pais", "objetivo", "publico", "orcamento",
] as const;

export function formatNamingDate(date: Date, format: string): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  switch (format) {
    case "DDMMYYYY": return `${dd}${mm}${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY": return `${dd}/${mm}/${yyyy}`;
    default: return `${yyyy}${mm}${dd}`;
  }
}

function variableValue(name: string, context: NamingContext, options: NamingOptions): string {
  if (name === "data") {
    return context.data ? formatNamingDate(context.data, options.dateFormat ?? "YYYYMMDD") : "";
  }
  if (name === "sequencia") {
    return context.sequencia != null ? String(context.sequencia).padStart(3, "0") : "";
  }
  if (name === "orcamento") {
    return context.orcamento != null ? String(context.orcamento) : "";
  }
  if (name.startsWith("arquivo:")) {
    const key = name.slice("arquivo:".length).trim();
    return context.arquivo?.[key] ?? "";
  }
  const key = name as keyof NamingContext;
  const value = context[key];
  return typeof value === "string" ? value : "";
}

export function resolveNamingPattern(
  pattern: string,
  context: NamingContext,
  options: NamingOptions = {},
): string {
  const separator = options.separator ?? "_";
  const replaced = pattern.replace(/\{([^{}]+)\}/g, (_match, raw: string) =>
    variableValue(raw.trim().toLowerCase(), context, options));
  const parts = replaced
    .split("|")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part.length > 0);
  let joined = parts.join(separator);
  joined = joined.replace(new RegExp(`(${escapeRegExp(separator)}){2,}`, "g"), separator)
    .replace(new RegExp(`^${escapeRegExp(separator)}|${escapeRegExp(separator)}$`, "g"), "")
    .trim();
  if (options.casing === "upper") return joined.toUpperCase();
  if (options.casing === "lower") return joined.toLowerCase();
  return joined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function listPatternVariables(pattern: string): string[] {
  const found = new Set<string>();
  for (const match of pattern.matchAll(/\{([^{}]+)\}/g)) {
    found.add(match[1]!.trim().toLowerCase());
  }
  return [...found];
}

export function unknownPatternVariables(pattern: string): string[] {
  return listPatternVariables(pattern).filter(
    (name) => !(KNOWN_VARIABLES as readonly string[]).includes(name) && !name.startsWith("arquivo:"),
  );
}

// UTMs (D-171): o mesmo motor resolve o template de parametros; a saida
// e a query string pronta para o campo de tags de URL da Meta.
export type UtmTemplate = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  custom?: Record<string, string>;
};

export function buildUtmQuery(
  template: UtmTemplate,
  context: NamingContext,
  options: NamingOptions = {},
): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["utm_source", template.utm_source],
    ["utm_medium", template.utm_medium],
    ["utm_campaign", template.utm_campaign],
    ["utm_content", template.utm_content],
    ["utm_term", template.utm_term],
    ...Object.entries(template.custom ?? {}),
  ];
  for (const [key, raw] of entries) {
    if (!raw) continue;
    const value = resolveNamingPattern(raw, context, options);
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function buildDestinationUrl(
  baseUrl: string,
  template: UtmTemplate,
  context: NamingContext,
  options: NamingOptions = {},
): string {
  const query = buildUtmQuery(template, context, options);
  if (!query) return baseUrl;
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${query}`;
}

// Expansao da estrutura (D-170): a partir de campanhas x conjuntos x
// anuncios e da lista de criativos, gera a matriz final da subida.
export type StructureSpec = {
  campaigns: number;
  adSetsPerCampaign: number;
  adsPerAdSet: number;
  duplications: number;
  distribution: "rotate" | "sequence" | "all";
};

export type ExpandedSlot = {
  campaignIndex: number;
  adSetIndex: number;
  adIndex: number;
  creativeIndex: number;
  sequence: number;
};

export function expandStructure(
  spec: StructureSpec,
  creativeCount: number,
): ExpandedSlot[] {
  const slots: ExpandedSlot[] = [];
  if (creativeCount <= 0) return slots;
  let sequence = 0;
  let creativeCursor = 0;
  const totalCopies = Math.max(1, spec.duplications);
  for (let copy = 0; copy < totalCopies; copy++) {
    for (let c = 0; c < spec.campaigns; c++) {
      for (let s = 0; s < spec.adSetsPerCampaign; s++) {
        for (let a = 0; a < spec.adsPerAdSet; a++) {
          let creativeIndex: number;
          if (spec.distribution === "all") {
            creativeIndex = a % creativeCount;
          } else if (spec.distribution === "sequence") {
            creativeIndex = Math.min(creativeCursor, creativeCount - 1);
          } else {
            creativeIndex = creativeCursor % creativeCount;
          }
          creativeCursor++;
          sequence++;
          slots.push({
            campaignIndex: c + copy * spec.campaigns,
            adSetIndex: s,
            adIndex: a,
            creativeIndex,
            sequence,
          });
        }
      }
    }
  }
  return slots;
}
