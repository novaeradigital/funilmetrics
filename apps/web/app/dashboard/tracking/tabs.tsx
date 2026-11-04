import Link from "next/link";

const items = [
  { key: "overview", href: "/dashboard/tracking", label: "Visão geral" },
  {
    key: "sources",
    href: "/dashboard/integracoes/tracking",
    label: "Fontes e script",
  },
  { key: "pixels", href: "/dashboard/tracking/pixels", label: "Pixels Meta" },
  {
    key: "events",
    href: "/dashboard/tracking/eventos",
    label: "Eventos enviados",
  },
] as const;

export type TrackingTabKey = (typeof items)[number]["key"];

export function TrackingTabs({ active }: { active: TrackingTabKey }) {
  return (
    <nav className="dashboard-mode-tabs" aria-label="Rastreamento">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={item.key === active ? "active" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
