import {describe,expect,it} from "vitest";
import {canEditDashboard,canManageDashboardAccess,canViewDashboard} from "./dashboard-permissions";

describe("dashboard permissions",()=>{
  it("reserva gestão de acesso a owner e administrator",()=>{
    expect(canManageDashboardAccess("owner")).toBe(true);
    expect(canManageDashboardAccess("administrator")).toBe(true);
    expect(canManageDashboardAccess("editor")).toBe(false);
  });

  it("mantém herança do projeto enquanto não existe ACL explícita",()=>{
    expect(canViewDashboard("viewer",false,null)).toBe(true);
    expect(canEditDashboard("editor",null)).toBe(true);
  });

  it("restringe um dashboard compartilhado ao nível concedido",()=>{
    expect(canViewDashboard("viewer",true,null)).toBe(false);
    expect(canViewDashboard("viewer",true,"view")).toBe(true);
    expect(canEditDashboard("editor","view",true)).toBe(false);
    expect(canEditDashboard("editor",null,true)).toBe(false);
    expect(canEditDashboard("editor","edit",true)).toBe(true);
  });
});
