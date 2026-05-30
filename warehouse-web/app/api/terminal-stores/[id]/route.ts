import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed } from "@/lib/auth-permissions";
import { updateTerminalStore, type UpdateTerminalStoreInput } from "@/lib/services/master-data-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await params;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as UpdateTerminalStoreInput;
    const result = await updateTerminalStore(id, input);
    await logOperation({
      user,
      request,
      action: input.status ? "MASTER_TERMINAL_STORE_STATUS_UPDATE" : "MASTER_TERMINAL_STORE_UPDATE",
      targetType: "TERMINAL_STORE",
      targetId: result.id,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "MASTER_TERMINAL_STORE_UPDATE",
      targetType: "TERMINAL_STORE",
      targetId: id,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
