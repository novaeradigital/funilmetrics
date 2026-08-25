import "server-only";
import { createConnection } from "node:net";

export function isClamAvPong(response: string) {
  return response.replaceAll("\0", "").trim() === "PONG";
}

export function checkClamAvConnection(input: {
  host: string;
  port: number;
  timeoutMs?: number;
}) {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: input.host, port: input.port });
    const timeoutMs = input.timeoutMs ?? 10_000;
    let response = "";
    const fail = (code: string) => {
      socket.destroy();
      reject(new Error(code));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => socket.write("zPING\0"));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (isClamAvPong(response)) {
        socket.destroy();
        resolve();
      }
    });
    socket.once("timeout", () => fail("clamav_timeout"));
    socket.once("error", () => fail("clamav_connection_failed"));
    socket.once("end", () => {
      if (!isClamAvPong(response)) fail("clamav_invalid_response");
    });
  });
}
