"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ImportFolderOption = { id: string; name: string };

type RejectedItem = { name: string; reason: string };

export function CreativeImportPanel({
  folders,
}: {
  folders: ImportFolderOption[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submitUpload() {
    const files = fileRef.current?.files;
    if (!files || !files.length) {
      setError("Escolha pelo menos um arquivo.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    form.set("folder_id", folderId);
    try {
      const response = await fetch("/dashboard/criativos/upload", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        accepted?: number;
        rejected?: RejectedItem[];
      };
      if (!response.ok || !data.ok) {
        setError(data.message ?? "O envio falhou. Tente de novo.");
      } else {
        const rejected = data.rejected ?? [];
        setMessage(
          `${data.accepted ?? 0} arquivo(s) enviado(s). O processamento (antivirus e organizacao) leva alguns instantes.` +
            (rejected.length
              ? ` Nao aceitos: ${rejected.map((item) => `${item.name} (${item.reason})`).join(", ")}.`
              : ""),
        );
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("O envio falhou. Tente de novo.");
    }
    setBusy(false);
  }

  return (
    <div className="creative-import-panel">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label>
          Arquivos (video ou imagem, ate 200 MB cada)
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="video/*,image/*,application/pdf,text/plain"
          />
        </label>
        <label>
          Pasta de destino
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">Sem pasta</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={submitUpload}>
          {busy ? "Enviando..." : "Enviar arquivos"}
        </button>
      </div>
      {message ? <p className="notice notice-success">{message}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}
    </div>
  );
}
