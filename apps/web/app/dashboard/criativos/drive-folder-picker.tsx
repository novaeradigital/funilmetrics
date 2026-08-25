"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type PickerDocument = { id: string; name?: string };
type PickerData = { action: string; docs?: PickerDocument[] };
type GooglePickerBuilder = {
  addView(view: unknown): GooglePickerBuilder;
  setAppId(value: string): GooglePickerBuilder;
  setDeveloperKey(value: string): GooglePickerBuilder;
  setOAuthToken(value: string): GooglePickerBuilder;
  setCallback(value: (data: PickerData) => void): GooglePickerBuilder;
  enableFeature(value: string): GooglePickerBuilder;
  build(): { setVisible(value: boolean): void };
};
type GooglePicker = {
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (viewId: string) => {
    setIncludeFolders(value: boolean): unknown;
    setSelectFolderEnabled(value: boolean): unknown;
    setMimeTypes(value: string): unknown;
  };
  Feature: { MULTISELECT_ENABLED: string };
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { FOLDERS: string };
};

declare global {
  interface Window {
    gapi?: { load(name: string, callback: () => void): void };
    google?: { picker?: GooglePicker };
  }
}

const folderMimeType = "application/vnd.google-apps.folder";

export function DriveFolderPicker({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.gapi),
  );
  const [state, setState] = useState<
    "idle" | "opening" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (window.gapi) {
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-fm-google-picker="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.dataset.fmGooglePicker = "true";
    script.onload = () => setScriptReady(true);
    script.onerror = () => {
      setState("error");
      setMessage("Não foi possível carregar o seletor seguro do Google.");
    };
    document.head.appendChild(script);
  }, []);

  async function saveFolders(documents: PickerDocument[]) {
    setState("saving");
    const failures: string[] = [];
    for (const document of documents) {
      const response = await fetch(
        "/dashboard/integracoes/google-drive/folders",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            folderId: document.id,
            includeSubfolders: true,
          }),
        },
      );
      if (!response.ok) failures.push(document.name ?? document.id);
    }
    if (failures.length) {
      setState("error");
      setMessage(
        `Não foi possível autorizar: ${failures.join(", ")}. Tente novamente.`,
      );
      return;
    }
    setState("success");
    setMessage(
      `${documents.length} pasta(s) autorizada(s). Nenhum arquivo foi importado ainda.`,
    );
    router.refresh();
  }

  async function openPicker() {
    setState("opening");
    setMessage("");
    try {
      const response = await fetch(
        `/dashboard/integracoes/google-drive/picker-session?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("picker_session_failed");
      const session = (await response.json()) as {
        accessToken: string;
        apiKey: string;
        appId: string;
      };
      window.gapi?.load("picker", () => {
        const pickerApi = window.google?.picker;
        if (!pickerApi) {
          setState("error");
          setMessage("O seletor do Google não ficou disponível.");
          return;
        }
        const view = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS);
        view.setIncludeFolders(true);
        view.setSelectFolderEnabled(true);
        view.setMimeTypes(folderMimeType);
        const picker = new pickerApi.PickerBuilder()
          .addView(view)
          .setAppId(session.appId)
          .setDeveloperKey(session.apiKey)
          .setOAuthToken(session.accessToken)
          .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
          .setCallback((data) => {
            if (data.action === pickerApi.Action.PICKED && data.docs?.length) {
              void saveFolders(data.docs);
            } else if (data.action === pickerApi.Action.CANCEL) {
              setState("idle");
            }
          })
          .build();
        picker.setVisible(true);
      });
    } catch {
      setState("error");
      setMessage(
        "Não foi possível abrir o Google Drive. Reconecte a conta ou verifique a configuração.",
      );
    }
  }

  return (
    <div className="drive-picker-control">
      <button
        className="creative-connect-button"
        disabled={!scriptReady || state === "opening" || state === "saving"}
        onClick={() => void openPicker()}
        type="button"
      >
        {state === "opening"
          ? "Abrindo Google Drive…"
          : state === "saving"
            ? "Salvando pastas…"
            : "Selecionar pastas no Google Drive"}
      </button>
      {!scriptReady && state !== "error" ? (
        <small>Carregando seletor seguro…</small>
      ) : null}
      {message ? (
        <p
          className={state === "success" ? "picker-success" : "picker-error"}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
