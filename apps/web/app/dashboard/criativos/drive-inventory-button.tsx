"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DriveInventoryButton({
  projectId,
  folderId,
}: {
  projectId: string;
  folderId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "requesting" | "error">("idle");

  async function requestInventory() {
    setState("requesting");
    const response = await fetch(
      "/dashboard/integracoes/google-drive/inventory",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, folderId }),
      },
    );
    if (!response.ok) {
      setState("error");
      return;
    }
    setState("idle");
    router.refresh();
  }

  return (
    <div className="inventory-action">
      <button
        disabled={state === "requesting"}
        onClick={() => void requestInventory()}
        type="button"
      >
        {state === "requesting" ? "Solicitando…" : "Inventariar agora"}
      </button>
      {state === "error" ? (
        <small role="alert">Não foi possível solicitar. Tente novamente.</small>
      ) : null}
    </div>
  );
}
