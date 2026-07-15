import { ApiError, fail, ok } from "@/lib/api-response";
import { assertWarehouseOperationAllowed, requireCurrentUser } from "@/lib/auth-permissions";
import { logOperation } from "@/lib/services/operation-log-service";
import {
  importTerminalReceipts,
  listTerminalReceiptImports,
  previewTerminalReceiptImport
} from "@/lib/services/terminal-receipt-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const url = new URL(request.url);
    return ok(await listTerminalReceiptImports(Number(url.searchParams.get("limit") ?? "20")));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let user = null;
  let fileName = "";
  try {
    user = await assertWarehouseOperationAllowed(request);
    const formData = await request.formData();
    const file = formData.get("file");
    const mode = formData.get("mode");
    if (!(file instanceof File)) throw new ApiError("请选择需要导入的 Excel 文件", 400);
    if (mode !== "preview" && mode !== "commit") throw new ApiError("无效的导入操作", 400);
    fileName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

    if (mode === "preview") return ok(await previewTerminalReceiptImport(file.name, buffer));

    const result = await importTerminalReceipts({
      fileName: file.name,
      buffer,
      operatorName: user.displayName
    });
    await logOperation({
      user,
      request,
      action: "TERMINAL_RECEIPT_IMPORT",
      targetType: "TERMINAL_RECEIPT_IMPORT",
      targetId: result.id,
      result: "SUCCESS",
      detail: `file=${file.name};imported=${result.importedRows};matched=${result.matchedRows};unmatched=${result.unmatchedRows};conflicts=${result.conflictRows};duplicates=${result.duplicateRows};replay=${result.replayed === true}`
    });
    return ok(result);
  } catch (error) {
    if (user) {
      await logOperation({
        user,
        request,
        action: "TERMINAL_RECEIPT_IMPORT",
        targetType: "TERMINAL_RECEIPT_IMPORT",
        result: "FAILURE",
        detail: `file=${fileName || "未选择"};error=${error instanceof Error ? error.message : "未知错误"}`
      });
    }
    return fail(error);
  }
}
