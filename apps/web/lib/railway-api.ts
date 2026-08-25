import "server-only";
import type { Pool } from "pg";
import {
  decryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "./integration-vault";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

export type RailwayConfiguration = {
  apiToken: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
};

type RailwayDnsRecord = {
  hostlabel: string;
  fqdn: string;
  recordType: string;
  requiredValue: string;
  currentValue: string;
  status: string;
  zone: string;
  purpose: string;
};

export type RailwayCustomDomain = {
  id: string;
  domain: string;
  status: {
    dnsRecords: RailwayDnsRecord[];
    certificateStatus: string;
    verificationToken: string;
    verificationDnsHost: string;
    verified: boolean;
  };
};

async function railwayRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await fetch(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`railway_http_${response.status}`);
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!payload.data || payload.errors?.length) {
    throw new Error("railway_graphql_failed");
  }
  return payload.data;
}

export async function loadProjectRailwayConfiguration(
  pool: Pool,
  projectId: string,
): Promise<RailwayConfiguration | null> {
  const result = await pool.query<{
    configuration: Record<string, unknown>;
    ciphertext: Buffer;
    initialization_vector: Buffer;
    authentication_tag: Buffer;
  }>(
    `select connection.configuration, secret.ciphertext,
            secret.initialization_vector, secret.authentication_tag
       from public.connections connection
       join public.integration_secrets secret
         on secret.project_id=connection.project_id
        and secret.provider='railway'
        and secret.kind='credential_bundle'
        and secret.rotated_at is null
      where connection.project_id=$1 and connection.provider='railway'
      order by connection.created_at desc limit 1`,
    [projectId],
  );
  const row = result.rows[0];
  const key = loadIntegrationVaultKey();
  if (!row || !key) return null;
  const secret = decryptIntegrationSecret(
    {
      ciphertext: row.ciphertext,
      initializationVector: row.initialization_vector,
      authenticationTag: row.authentication_tag,
    },
    key,
  );
  const apiToken = String(secret.apiToken ?? "");
  const projectIdValue = String(row.configuration.projectId ?? "");
  const environmentId = String(row.configuration.environmentId ?? "");
  const serviceId = String(row.configuration.serviceId ?? "");
  if (!apiToken || !projectIdValue || !environmentId || !serviceId) return null;
  return { apiToken, projectId: projectIdValue, environmentId, serviceId };
}

export async function validateRailwayToken(token: string) {
  return railwayRequest<{ me: { id: string; email: string } }>(
    token,
    "query ValidateRailwayToken { me { id email } }",
  );
}

export async function createRailwayCustomDomain(
  configuration: RailwayConfiguration,
  domain: string,
) {
  const result = await railwayRequest<{
    customDomainCreate: RailwayCustomDomain;
  }>(
    configuration.apiToken,
    `mutation CreateCustomDomain($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) {
        id
        domain
        status {
          dnsRecords {
            hostlabel
            fqdn
            recordType
            requiredValue
            currentValue
            status
            zone
            purpose
          }
          certificateStatus
          verificationToken
          verificationDnsHost
          verified
        }
      }
    }`,
    {
      input: {
        projectId: configuration.projectId,
        environmentId: configuration.environmentId,
        serviceId: configuration.serviceId,
        domain,
      },
    },
  );
  return result.customDomainCreate;
}

export async function deleteRailwayCustomDomain(
  configuration: RailwayConfiguration,
  customDomainId: string,
) {
  const result = await railwayRequest<{customDomainDelete:boolean}>(
    configuration.apiToken,
    `mutation DeleteCustomDomain($id: String!) {
      customDomainDelete(id: $id)
    }`,
    {id:customDomainId},
  );
  return result.customDomainDelete;
}
