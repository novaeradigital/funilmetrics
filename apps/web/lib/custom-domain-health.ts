import "server-only";
import { resolveCname, resolveTxt } from "node:dns/promises";

function normalizeDnsValue(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export async function inspectCustomDomainHealth(input: {
  hostname: string;
  trafficDnsValue: string;
  providerVerificationDnsHost: string | null;
  providerVerificationDnsValue: string | null;
}) {
  let routeReady = false;
  let providerOwnershipReady = !input.providerVerificationDnsValue;
  try {
    const aliases = await resolveCname(input.hostname);
    routeReady = aliases.some(
      (alias) =>
        normalizeDnsValue(alias) === normalizeDnsValue(input.trafficDnsValue),
    );
  } catch {}
  if (
    input.providerVerificationDnsHost &&
    input.providerVerificationDnsValue
  ) {
    try {
      const verificationHost=input.providerVerificationDnsHost.endsWith(input.hostname)
        ? input.providerVerificationDnsHost
        : `${input.providerVerificationDnsHost}.${input.hostname.split(".").slice(1).join(".")}`;
      const records = await resolveTxt(verificationHost);
      providerOwnershipReady = records.some(
        (parts) => parts.join("") === input.providerVerificationDnsValue,
      );
    } catch {}
  }
  let httpsReady = false;
  if (routeReady && providerOwnershipReady) {
    try {
      const response = await fetch(`https://${input.hostname}/login`, {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      httpsReady = response.status < 500;
    } catch {}
  }
  return { routeReady, providerOwnershipReady, httpsReady };
}
