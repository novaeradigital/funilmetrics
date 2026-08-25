export type CreativeImportReadinessError =
  | "r2_validation_required"
  | "clamav_validation_required";

export function creativeImportReadiness(input: {
  storageReady: boolean;
  antimalwareReady: boolean;
}) {
  const error: CreativeImportReadinessError | null = !input.storageReady
    ? "r2_validation_required"
    : !input.antimalwareReady
      ? "clamav_validation_required"
      : null;
  return { ready: error === null, error };
}
