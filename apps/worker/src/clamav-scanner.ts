import { createConnection, type Socket } from "node:net";

export type ClamAvConfig = {
  host: string;
  port: number;
  timeoutMs: number;
  maxBytes: number;
};

export type MalwareScanResult =
  | { status: "clean" }
  | { status: "infected"; threat: string }
  | { status: "unsupported"; detail: string }
  | { status: "failed_retryable"; code: string };

export function loadClamAvConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ClamAvConfig | null {
  const host = environment.CLAMAV_HOST?.trim();
  const portText = environment.CLAMAV_PORT?.trim();
  const supplied = Boolean(host || portText);
  if (!supplied) return null;
  const port = Number(portText ?? "3310");
  const timeoutMs = Number(environment.CLAMAV_TIMEOUT_MS ?? "120000");
  const maxBytes = Number(environment.CLAMAV_MAX_BYTES ?? "2147483648");
  if (
    !host ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  ) {
    throw new Error("clamav_configuration_invalid");
  }
  return { host, port, timeoutMs, maxBytes };
}

export function parseClamAvResponse(rawResponse: string): MalwareScanResult {
  const response = rawResponse.replaceAll("\0", "").trim();
  if (response.endsWith(": OK")) return { status: "clean" };
  const found = response.match(/:\s+(.+)\s+FOUND$/);
  if (found?.[1]) {
    return {
      status: "infected",
      threat: found[1].replace(/[^\w.\- ]/g, "").slice(0, 160),
    };
  }
  if (/size limit|unsupported|not supported/i.test(response)) {
    return { status: "unsupported", detail: response.slice(0, 200) };
  }
  return { status: "failed_retryable", code: "clamav_unexpected_response" };
}

function chunkHeader(length: number) {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(length);
  return header;
}

function write(socket: Socket, data: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("error", onError);
      reject(error);
    };
    socket.once("error", onError);
    socket.write(data, () => {
      socket.off("error", onError);
      resolve();
    });
  });
}

export async function scanStreamWithClamAv(
  source: AsyncIterable<Uint8Array>,
  config: ClamAvConfig,
): Promise<MalwareScanResult> {
  const socket = createConnection({ host: config.host, port: config.port });
  socket.setTimeout(config.timeoutMs);
  let response = "";
  const resultPromise = new Promise<MalwareScanResult>((resolve) => {
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("end", () => resolve(parseClamAvResponse(response)));
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ status: "failed_retryable", code: "clamav_timeout" });
    });
    socket.once("error", () =>
      resolve({ status: "failed_retryable", code: "clamav_connection_failed" }),
    );
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    await write(socket, Buffer.from("zINSTREAM\0"));
    let totalBytes = 0;
    for await (const chunk of source) {
      totalBytes += chunk.byteLength;
      if (totalBytes > config.maxBytes) {
        socket.destroy();
        return { status: "unsupported", detail: "file_size_limit_exceeded" };
      }
      await write(socket, chunkHeader(chunk.byteLength));
      await write(socket, chunk);
    }
    await write(socket, chunkHeader(0));
    return await resultPromise;
  } catch {
    socket.destroy();
    return { status: "failed_retryable", code: "clamav_connection_failed" };
  } finally {
    socket.destroy();
  }
}
