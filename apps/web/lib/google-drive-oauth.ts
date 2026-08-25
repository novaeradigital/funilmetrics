import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const googleDriveScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  encryptionKey: Buffer;
};

type OAuthState = {
  userId: string;
  projectId: string;
  nonce: string;
  expiresAt: number;
};

export function loadGoogleOAuthConfig(
  environment: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig | null {
  const values = {
    clientId: environment.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: environment.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri: environment.GOOGLE_REDIRECT_URI?.trim(),
    stateSecret: environment.GOOGLE_OAUTH_STATE_SECRET?.trim(),
    encryptionKey: environment.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim(),
  };
  const supplied = Object.values(values).filter(Boolean).length;
  if (supplied === 0) return null;
  if (Object.values(values).some((value) => !value)) {
    throw new Error("google_oauth_configuration_incomplete");
  }
  const encryptionKey = Buffer.from(values.encryptionKey!, "base64");
  if (values.stateSecret!.length < 32 || encryptionKey.length !== 32) {
    throw new Error("google_oauth_security_configuration_invalid");
  }
  return {
    clientId: values.clientId!,
    clientSecret: values.clientSecret!,
    redirectUri: values.redirectUri!,
    stateSecret: values.stateSecret!,
    encryptionKey,
  };
}

export function createOAuthState(
  input: Omit<OAuthState, "expiresAt">,
  secret: string,
) {
  const payload: OAuthState = {
    ...input,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(value: string, secret: string): OAuthState {
  const [encoded, suppliedSignature] = value.split(".");
  if (!encoded || !suppliedSignature) throw new Error("oauth_state_invalid");
  const expectedSignature = createHmac("sha256", secret)
    .update(encoded)
    .digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    throw new Error("oauth_state_invalid");
  }
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Partial<OAuthState>;
  if (
    typeof payload.userId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt < Date.now()
  ) {
    throw new Error("oauth_state_expired");
  }
  return payload as OAuthState;
}

export function peekOAuthStateProjectId(value: string) {
  const [encoded] = value.split(".");
  if (!encoded) throw new Error("oauth_state_invalid");
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as { projectId?: unknown };
  if (
    typeof payload.projectId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.projectId,
    )
  ) {
    throw new Error("oauth_state_invalid");
  }
  return payload.projectId;
}

export function buildGoogleAuthorizationUrl(
  config: GoogleOAuthConfig,
  state: string,
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleDriveScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

export function encryptRefreshToken(token: string, key: Buffer) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext,
    initializationVector,
    authenticationTag: cipher.getAuthTag(),
  };
}

export function decryptRefreshToken(
  encrypted: {
    ciphertext: Buffer;
    initializationVector: Buffer;
    authenticationTag: Buffer;
  },
  key: Buffer,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encrypted.initializationVector,
  );
  decipher.setAuthTag(encrypted.authenticationTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function loadGooglePickerConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const apiKey = environment.GOOGLE_PICKER_API_KEY?.trim();
  const appId = environment.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();
  if (!apiKey && !appId) return null;
  if (!apiKey || !appId || !/^\d+$/.test(appId)) {
    throw new Error("google_picker_configuration_invalid");
  }
  return { apiKey, appId };
}
