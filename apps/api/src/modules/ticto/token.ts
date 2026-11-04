import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 32;
const formatVersion = "scrypt-v1";

export async function hashWebhookToken(token: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(token, salt, keyLength)) as Buffer;

  return [
    formatVersion,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyWebhookToken(token: string, storedHash: string) {
  const [version, saltText, hashText] = storedHash.split("$");

  if (version !== formatVersion || !saltText || !hashText) {
    return false;
  }

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(token, salt, expected.length)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
