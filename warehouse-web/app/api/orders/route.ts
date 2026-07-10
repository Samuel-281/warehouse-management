import { ApiError, fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listOrderSummaries } from "@/lib/services/order-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const url = new URL(request.url);
    return ok(
      await listOrderSummaries({
        kind: (url.searchParams.get("kind") ?? "all") as "all" | "inbound" | "outbound" | "sales_return",
        status: (url.searchParams.get("status") ?? "all") as "all" | "active" | "voided",
        barcode: url.searchParams.get("barcode") ?? "",
        page: Number(url.searchParams.get("page") ?? "1"),
        pageSize: Number(url.searchParams.get("pageSize") ?? "20")
      })
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireCurrentUser(request);
    throw new ApiError("业务单据不能直接删除，请使用单据撤销并填写撤销原因", 405);
  } catch (error) {
    return fail(error);
  }
}
