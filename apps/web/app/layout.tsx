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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
