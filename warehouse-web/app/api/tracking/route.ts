import { fail, ok } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { listTrackedBarcodes } from "@/lib/services/tracking-service";

export async function GET(request: Request) {
  try {
    await requireCurrentUser(request);
    const { searchParams } = new URL(request.url);
    return ok(await listTrackedBarcodes({
      keyword: searchParams.get("keyword") ?? undefined,
      receiptStatus: searchParams.get("receiptStatus") ?? undefined,
      ownerType: searchParams.get("ownerType") ?? undefined,
      warehouseId: searchParams.get("warehouseId") ?? undefined,
      salespersonId: searchParams.get("salespersonId") ?? undefined,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20)
    }));
  } catch (error) {
    return fail(error, 400);
  }
}
