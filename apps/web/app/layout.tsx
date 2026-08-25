import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./dashboard-editor.css";

export const metadata: Metadata = {
  title: "Funil Metrics",
  description: "Inteligência de funis e jornada do cliente",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
