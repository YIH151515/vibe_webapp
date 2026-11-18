import { forbidden, type Principal } from "./auth-principal";

export type OwnedRow = { author_tenant_id: string | null; author_object_id: string | null };
export function ownsPost(row: OwnedRow, principal: Principal): boolean {
  return row.author_tenant_id?.toLowerCase() === principal.tenantId && row.author_object_id?.toLowerCase() === principal.objectId;
}
export function requirePostOwner(row: OwnedRow, principal: Principal): void {
  if (!ownsPost(row, principal)) throw forbidden();
}
export function postPermissions(row: OwnedRow, principal: Principal) {
  const canEdit = ownsPost(row, principal);
  return { canEdit, canDelete: canEdit || principal.isAdmin };
}
