import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";

type R2Client = {
  send(command: object): Promise<unknown>;
};

export type R2StorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type QuarantineObject = {
  organizationId: string;
  projectId: string;
  importJobId: string;
  importItemId: string;
  body: PutObjectCommandInput["Body"];
  mimeType: string;
  sizeBytes: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

function uuid(value: string, field: string) {
  if (!uuidPattern.test(value)) throw new Error(`${field}_invalid`);
  return value.toLowerCase();
}

function sha256(value: string) {
  if (!sha256Pattern.test(value)) throw new Error("content_sha256_invalid");
  return value;
}

export function loadR2StorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): R2StorageConfig | null {
  const values = {
    accountId: environment.R2_ACCOUNT_ID?.trim(),
    endpoint: environment.R2_ENDPOINT?.trim(),
    accessKeyId: environment.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY?.trim(),
    bucket: environment.R2_BUCKET?.trim(),
  };
  const supplied = Object.values(values).filter(Boolean).length;
  if (supplied === 0) return null;
  if (
    !values.accessKeyId ||
    !values.secretAccessKey ||
    !values.bucket ||
    (!values.endpoint && !values.accountId)
  ) {
    throw new Error("r2_configuration_incomplete");
  }
  return {
    endpoint:
      values.endpoint ??
      `https://${values.accountId}.r2.cloudflarestorage.com`,
    accessKeyId: values.accessKeyId,
    secretAccessKey: values.secretAccessKey,
    bucket: values.bucket,
  };
}

export function quarantineObjectKey(input: Omit<QuarantineObject, "body" | "mimeType" | "sizeBytes">) {
  return [
    "quarantine",
    uuid(input.organizationId, "organization_id"),
    uuid(input.projectId, "project_id"),
    uuid(input.importJobId, "import_job_id"),
    uuid(input.importItemId, "import_item_id"),
  ].join("/");
}

export function privateAssetObjectKey(
  organizationId: string,
  projectId: string,
  contentSha256: string,
) {
  return [
    "assets-private",
    uuid(organizationId, "organization_id"),
    uuid(projectId, "project_id"),
    sha256(contentSha256),
  ].join("/");
}

export class R2CreativeStorage {
  constructor(
    private readonly config: R2StorageConfig,
    private readonly client: R2Client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  ) {}

  async putInQuarantine(input: QuarantineObject) {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new Error("size_bytes_invalid");
    }
    const key = quarantineObjectKey(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
        Metadata: {
          organization_id: input.organizationId,
          project_id: input.projectId,
          import_job_id: input.importJobId,
          import_item_id: input.importItemId,
          availability: "quarantined",
        },
      }),
    );
    return { key };
  }

  async assertObjectExists(key: string) {
    await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async getPrivateObject(key: string) {
    if (!key.startsWith("assets-private/")) {
      throw new Error("private_object_key_invalid");
    }
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )) as { Body?: NodeJS.ReadableStream };
    if (!response.Body) throw new Error("private_object_body_missing");
    return response.Body;
  }

  async getQuarantineObject(key: string) {
    if (!key.startsWith("quarantine/")) {
      throw new Error("quarantine_key_invalid");
    }
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )) as { Body?: NodeJS.ReadableStream };
    if (!response.Body) throw new Error("quarantine_object_body_missing");
    return response.Body;
  }

  async promoteCleanObject(input: {
    quarantineKey: string;
    organizationId: string;
    projectId: string;
    contentSha256: string;
    scanStatus: "clean";
  }) {
    if (!input.quarantineKey.startsWith("quarantine/")) {
      throw new Error("quarantine_key_invalid");
    }
    if (input.scanStatus !== "clean") throw new Error("malware_scan_not_clean");
    const targetKey = privateAssetObjectKey(
      input.organizationId,
      input.projectId,
      input.contentSha256,
    );
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: targetKey,
        CopySource: encodeURIComponent(
          `${this.config.bucket}/${input.quarantineKey}`,
        ).replaceAll("%2F", "/"),
        MetadataDirective: "COPY",
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: input.quarantineKey,
      }),
    );
    return { key: targetKey };
  }

  async deleteQuarantineObject(key: string) {
    if (!key.startsWith("quarantine/")) {
      throw new Error("quarantine_key_invalid");
    }
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}
