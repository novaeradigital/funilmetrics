"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DriveImportButton({
  projectId,
  jobId,
}: {
  projectId: string;
  jobId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "requesting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function confirmImport() {
    setState("requesting");
    const response = await fetch(
      "/dashboard/integracoes/google-drive/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, jobId }),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setErrorMessage(
        payload?.error === "r2_validation_required"
          ? "Valide o bucket R2 em Integrações antes de importar."
          : payload?.error === "clamav_validation_required"
            ? "Valide a conexão ClamAV em Integrações antes de importar."
            : "A importação não pôde ser iniciada.",
      );
      setState("error");
      return;
    }
    setErrorMessage("");
    setState("idle");
    router.refresh();
  }

  return (
    <div className="inventory-action">
      <button
        disabled={state === "requesting"}
        onClick={() => void confirmImport()}
        type="button"
      >
        {state === "requesting" ? "Confirmando…" : "Confirmar importação"}
      </button>
      {state === "error" ? (
        <small role="alert">{errorMessage}</small>
      ) : null}
    </div>
  );
}
