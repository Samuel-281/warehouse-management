import { fail, ok } from "@/lib/api-response";
import { assertSuperAdminAllowed } from "@/lib/auth-permissions";
import { runConsistencyAudit } from "@/lib/services/consistency-audit-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function GET(request: Request) {
  let user = null;
  try {
    user = await assertSuperAdminAllowed(request);
    const result = await runConsistencyAudit();
    await logOperation({
      user,
      request,
      action: "SYSTEM_CONSISTENCY_AUDIT",
      targetType: "SYSTEM",
      result: "SUCCESS",
      detail: `healthy=${result.healthy};errors=${result.severityCounts.error};info=${result.severityCounts.info}`
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "SYSTEM_CONSISTENCY_AUDIT",
      targetType: "SYSTEM",
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error);
  }
}
