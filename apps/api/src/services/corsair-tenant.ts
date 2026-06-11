import { getCorsair } from "../corsair";

export async function ensureCorsairTenant(tenantId: string) {
  const corsair = getCorsair();
  try {
    await corsair.manage.tenants.get(tenantId);
  } catch {
    await corsair.manage.tenants.create({ id: tenantId });
  }
}
