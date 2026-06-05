import { fail, ok } from "@/lib/api-response";
import { assertMasterDataAllowed, assertMasterDataDeleteAllowed } from "@/lib/auth-permissions";
import { deleteSalesperson, updateSalesperson, type UpdateSalespersonInput } from "@/lib/services/master-data-service";
import { logOperation } from "@/lib/services/operation-log-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await params;
  try {
    user = await assertMasterDataAllowed(request);
    const input = (await request.json()) as UpdateSalespersonInput;
    const result = await updateSalesperson(id, input);
    await logOperation({
      user,
      request,
      action: input.status ? "MASTER_SALESPERSON_STATUS_UPDATE" : "MASTER_SALESPERSON_UPDATE",
      targetType: "SALESPERSON",
      targetId: result.id,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "MASTER_SALESPERSON_UPDATE",
      targetType: "SALESPERSON",
      targetId: id,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user = null;
  const { id } = await params;
  try {
    user = await assertMasterDataDeleteAllowed(request);
    const result = await deleteSalesperson(id);
    await logOperation({
      user,
      request,
      action: "MASTER_SALESPERSON_DELETE",
      targetType: "SALESPERSON",
      targetId: id,
      result: "SUCCESS"
    });
    return ok(result);
  } catch (error) {
    await logOperation({
      user,
      request,
      action: "MASTER_SALESPERSON_DELETE",
      targetType: "SALESPERSON",
      targetId: id,
      result: "FAILURE",
      detail: error instanceof Error ? error.message : undefined
    });
    return fail(error, 400);
  }
}
