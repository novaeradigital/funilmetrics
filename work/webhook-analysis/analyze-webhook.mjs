import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2] ?? "C:\\Users\\fabio\\Downloads\\webhook_logs_2026-07-23.xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const sheet = workbook.worksheets.getItemAt(0);
const rows = sheet.getUsedRange().values;
const headers = rows[0];
const index = Object.fromEntries(headers.map((h, i) => [h, i]));
const dataRows = rows.slice(1);

const tally = (items) =>
  Object.fromEntries(
    [...items.reduce((m, x) => m.set(String(x), (m.get(String(x)) ?? 0) + 1), new Map())]
      .sort((a, b) => b[1] - a[1]),
  );

const parsed = [];
const parseErrors = [];
for (let i = 0; i < dataRows.length; i++) {
  try {
    parsed.push({
      row: i + 2,
      status: dataRows[i][index.Status],
      code: dataRows[i][index.Code],
      event: dataRows[i][index.Event],
      createdAt: dataRows[i][index.CreatedAt],
      payload: JSON.parse(dataRows[i][index.Payload]),
    });
  } catch (error) {
    parseErrors.push({ row: i + 2, error: String(error) });
  }
}

const eventCounts = tally(parsed.map((r) => r.event));
const statusCounts = tally(parsed.map((r) => r.status));
const codeCounts = tally(parsed.map((r) => r.code));
const paymentIds = parsed.map((r) => r.payload?.Purchase?.PaymentId).filter(Boolean);
const paymentCounts = tally(paymentIds);
const duplicatePaymentIds = Object.values(paymentCounts).filter((n) => n > 1);

const utmKeys = ["UtmId", "UtmSource", "UtmMedium", "UtmCampaign", "UtmTerm", "UtmContent", "Src"];
const utmCoverage = {};
for (const key of utmKeys) {
  utmCoverage[key] = parsed.filter((r) => {
    const value = r.payload?.Utm?.[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  }).length;
}

const topLevelKeys = new Set();
const purchaseKeys = new Set();
const buyerKeys = new Set();
const utmFieldKeys = new Set();
for (const r of parsed) {
  Object.keys(r.payload ?? {}).forEach((k) => topLevelKeys.add(k));
  Object.keys(r.payload?.Purchase ?? {}).forEach((k) => purchaseKeys.add(k));
  Object.keys(r.payload?.Buyer ?? {}).forEach((k) => buyerKeys.add(k));
  Object.keys(r.payload?.Utm ?? {}).forEach((k) => utmFieldKeys.add(k));
}

const productCountDistribution = tally(
  parsed.map((r) => Array.isArray(r.payload?.Products) ? r.payload.Products.length : 0),
);
const productNames = tally(
  parsed.flatMap((r) => (r.payload?.Products ?? []).map((p) => p.Name)),
);
const sourceCounts = tally(
  parsed.map((r) => r.payload?.Utm?.UtmSource ?? "(sem utm_source)"),
);
const paymentMethods = tally(
  parsed.map((r) => r.payload?.Purchase?.Payment?.PaymentMethod ?? "(ausente)"),
);
const upsellCounts = tally(
  parsed.map((r) => r.payload?.Purchase?.IsUpsell ?? "(ausente)"),
);
const utmEmpty = parsed.filter((r) => Object.keys(r.payload?.Utm ?? {}).length === 0).length;
const hasMlid = parsed.filter((r) => {
  const origin = r.payload?.Purchase?.OriginUrl ?? "";
  return /(?:[?&](?:mlid|utm_mlid)=)/i.test(origin);
}).length;
const hasFbclid = parsed.filter((r) => /(?:[?&]fbclid=)/i.test(r.payload?.Purchase?.OriginUrl ?? "")).length;
const uniqueBuyers = new Set(parsed.map((r) => r.payload?.Buyer?.Id).filter(Boolean)).size;
const samePhoneDifferentBuyerIds = (() => {
  const map = new Map();
  for (const r of parsed) {
    const phone = r.payload?.Buyer?.PhoneNumber;
    const buyerId = r.payload?.Buyer?.Id;
    if (!phone || !buyerId) continue;
    if (!map.has(phone)) map.set(phone, new Set());
    map.get(phone).add(buyerId);
  }
  return [...map.values()].filter((s) => s.size > 1).length;
})();

const perEvent = {};
for (const eventName of Object.keys(eventCounts)) {
  const group = parsed.filter((r) => r.event === eventName);
  const groupPaymentIds = group.map((r) => r.payload?.Purchase?.PaymentId).filter(Boolean);
  const productCounts = group.map((r) => r.payload?.Products?.length ?? 0);
  perEvent[eventName] = {
    rows: group.length,
    uniquePaymentIds: new Set(groupPaymentIds).size,
    missingPaymentId: group.length - groupPaymentIds.length,
    uniqueBuyerIds: new Set(group.map((r) => r.payload?.Buyer?.Id).filter(Boolean)).size,
    utmObjectEmpty: group.filter((r) => Object.keys(r.payload?.Utm ?? {}).length === 0).length,
    utmCampaignPresent: group.filter((r) => String(r.payload?.Utm?.UtmCampaign ?? "").trim() !== "").length,
    productsMin: Math.min(...productCounts),
    productsMax: Math.max(...productCounts),
    purchaseFields: [...new Set(group.flatMap((r) => Object.keys(r.payload?.Purchase ?? {})))].sort(),
  };
}

const lifecycleByPayment = new Map();
for (const r of parsed) {
  const paymentId = r.payload?.Purchase?.PaymentId;
  if (!paymentId) continue;
  if (!lifecycleByPayment.has(paymentId)) lifecycleByPayment.set(paymentId, new Set());
  lifecycleByPayment.get(paymentId).add(r.event);
}
const lifecyclePatterns = tally(
  [...lifecycleByPayment.values()].map((events) => [...events].sort().join(" + ")),
);

console.log(JSON.stringify({
  workbook: { sheet: sheet.name, rows: dataRows.length, columns: headers },
  parsedRows: parsed.length,
  parseErrors,
  eventCounts,
  statusCounts,
  codeCounts,
  uniquePaymentIds: new Set(paymentIds).size,
  duplicatePaymentIdGroups: duplicatePaymentIds.length,
  maxOccurrencesPerPaymentId: Math.max(...Object.values(paymentCounts)),
  uniqueBuyerIds: uniqueBuyers,
  phonesMappedToMultipleBuyerIds: samePhoneDifferentBuyerIds,
  utmCoverage,
  utmEmpty,
  hasMlid,
  hasFbclid,
  topLevelKeys: [...topLevelKeys].sort(),
  purchaseKeys: [...purchaseKeys].sort(),
  buyerKeys: [...buyerKeys].sort(),
  utmFieldKeys: [...utmFieldKeys].sort(),
  productCountDistribution,
  productNames,
  sourceCounts,
  paymentMethods,
  upsellCounts,
  perEvent,
  lifecyclePatterns,
}, null, 2));
