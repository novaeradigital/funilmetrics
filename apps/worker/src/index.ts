import { readFileSync } from "node:fs";
import { createDatabase } from "@funil-metrics/database";
import { PRODUCT_NAME } from "@funil-metrics/domain";
import { processLastlinkBatch } from "./lastlink-processor.js";
import { processConfigCheckoutBatch } from "./configcheckout-processor.js";
import { evaluateDataQuality } from "./data-quality-monitor.js";
import { loadR2StorageConfig } from "./r2-storage.js";
import { loadClamAvConfig } from "./clamav-scanner.js";
import { processGoogleDriveInventory } from "./google-drive-inventory.js";
import { processGoogleDriveImport } from "./google-drive-import.js";
import { processCreativeTranscription } from "./creative-transcription.js";
import { processCreativeAnalysis } from "./creative-analysis.js";
import { processCampaignUploads } from "./campaign-publisher.js";
import { scheduleGoogleDriveSync } from "./google-drive-sync-scheduler.js";
import {processCreativeTextExtraction} from "./creative-text-extraction.js";
import {scheduleMetaSync} from "./meta-sync-scheduler.js";
import {processMetaSync} from "./meta-sync.js";
import {generateScheduledReport} from "./report-scheduler.js";
import {processCurrencyConversions} from "./currency-conversion.js";

type WorkerStatus = {
  service: string;
  status: "ready";
  queueDriver: string;
  objectStorage: "r2" | "project-scoped" | "disabled";
  antimalware: "clamav" | "project-scoped" | "disabled";
};

export function getWorkerStatus(): WorkerStatus {
  return {
    service: `${PRODUCT_NAME} Worker`,
    status: "ready",
    queueDriver: process.env.QUEUE_DRIVER ?? "memory",
    objectStorage: loadR2StorageConfig()
      ? "r2"
      : process.env.INTEGRATION_SECRET_ENCRYPTION_KEY
        ? "project-scoped"
        : "disabled",
    antimalware: loadClamAvConfig()
      ? "clamav"
      : process.env.INTEGRATION_SECRET_ENCRYPTION_KEY
        ? "project-scoped"
        : "disabled",
  };
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} deve ser um inteiro positivo.`);
  }
  return value;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runWorker(signal: AbortSignal) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }

  const intervalMs = positiveInteger("WORKER_POLL_INTERVAL_MS", 5_000);
  const batchSize = positiveInteger("WORKER_BATCH_SIZE", 25);
  const maxAttempts = positiveInteger("WORKER_MAX_ATTEMPTS", 5);
  const qualityIntervalMs = positiveInteger(
    "DATA_QUALITY_INTERVAL_MS",
    60_000,
  );
  let lastQualityCheckAt = 0;
  const database = createDatabase(process.env.DATABASE_URL, {
    sslCa: process.env.DATABASE_SSL_CA_FILE
      ? readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8")
      : undefined,
    sslRejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
        ? false
        : undefined,
  });

  process.stdout.write(
    `${JSON.stringify({
      ...getWorkerStatus(),
      event: "worker_started",
      intervalMs,
      batchSize,
      maxAttempts,
    })}\n`,
  );

  try {
    while (!signal.aborted) {
      try {
        const result = await processLastlinkBatch(
          database.pool,
          batchSize,
          maxAttempts,
        );
        if (result.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "lastlink_batch_processed", ...result })}\n`,
          );
        }
        const configCheckoutResult = await processConfigCheckoutBatch(
          database.pool,
          batchSize,
          maxAttempts,
        );
        if (configCheckoutResult.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "configcheckout_batch_processed", ...configCheckoutResult })}\n`,
          );
        }
        const driveInventory = await processGoogleDriveInventory(database.pool);
        if (driveInventory.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "drive_inventory_processed", ...driveInventory })}\n`,
          );
        }
        const scheduledDriveSync=await scheduleGoogleDriveSync(database.pool);
        if(scheduledDriveSync.scheduled>0){
          process.stdout.write(`${JSON.stringify({event:"drive_sync_scheduled",...scheduledDriveSync})}\n`);
        }
        const scheduledMetaSync=await scheduleMetaSync(database.pool);
        if(scheduledMetaSync.scheduled>0){
          process.stdout.write(`${JSON.stringify({
            event:"meta_sync_scheduled",...scheduledMetaSync,
          })}\n`);
        }
        const metaSync=await processMetaSync(database.pool,maxAttempts);
        if(metaSync.claimed>0){
          process.stdout.write(`${JSON.stringify({
            event:"meta_sync_processed",...metaSync,
          })}\n`);
        }
        const currencyConversion=await processCurrencyConversions(database.pool);
        if(currencyConversion.considered>0){
          process.stdout.write(`${JSON.stringify({event:"currency_conversion_processed",...currencyConversion})}\n`);
        }
        const driveImport = await processGoogleDriveImport(database.pool);
        if (driveImport.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "drive_import_processed", ...driveImport })}\n`,
          );
        }
        const transcription = await processCreativeTranscription(
          database.pool,
          maxAttempts,
        );
        if (transcription.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "creative_transcription_processed", ...transcription })}\n`,
          );
        }
        const textExtraction=await processCreativeTextExtraction(database.pool,maxAttempts);
        if(textExtraction.claimed>0){
          process.stdout.write(`${JSON.stringify({event:"creative_text_extraction_processed",...textExtraction})}\n`);
        }
        const campaignUploads = await processCampaignUploads(database.pool);
        if (campaignUploads.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "campaign_upload_processed", ...campaignUploads })}\n`,
          );
        }
        const analysis = await processCreativeAnalysis(database.pool, maxAttempts);
        if (analysis.claimed > 0) {
          process.stdout.write(
            `${JSON.stringify({ event: "creative_analysis_processed", ...analysis })}\n`,
          );
        }
        const scheduledReport=await generateScheduledReport(database.pool);
        if(scheduledReport.generated>0){
          process.stdout.write(`${JSON.stringify({
            event:"financial_report_snapshot_generated",...scheduledReport,
          })}\n`);
        }
        const currentTime = Date.now();
        if (currentTime - lastQualityCheckAt >= qualityIntervalMs) {
          const quality = await evaluateDataQuality(database.pool);
          lastQualityCheckAt = currentTime;
          process.stdout.write(
            `${JSON.stringify({ event: "data_quality_evaluated", ...quality })}\n`,
          );
        }
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "worker_cycle_failed";
        const message =
          error instanceof Error ? error.message.slice(0, 240) : undefined;
        process.stderr.write(
          `${JSON.stringify({ event: "worker_cycle_failed", code, message })}\n`,
        );
      }
      await wait(intervalMs, signal);
    }
  } finally {
    await database.close();
    process.stdout.write(`${JSON.stringify({ event: "worker_stopped" })}\n`);
  }
}

if (process.env.NODE_ENV !== "test") {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  await runWorker(controller.signal);
}
