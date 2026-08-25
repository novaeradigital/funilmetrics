export type DashboardAccessLevel = "view" | "edit";

export function canManageDashboardAccess(role: string) {
  return role === "owner" || role === "administrator";
}

export function canEditDashboard(
  role: string,
  explicitAccess: DashboardAccessLevel | null,
  hasExplicitAcl = false,
) {
  if (canManageDashboardAccess(role)) return true;
  if (!["editor"].includes(role)) return false;
  return (!hasExplicitAcl && explicitAccess === null) || explicitAccess === "edit";
}

export function canViewDashboard(role: string, hasExplicitAcl: boolean, explicitAccess: DashboardAccessLevel | null) {
  if (canManageDashboardAccess(role)) return true;
  return !hasExplicitAcl || explicitAccess === "view" || explicitAccess === "edit";
}
