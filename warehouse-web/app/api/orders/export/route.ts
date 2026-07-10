import { fail } from "@/lib/api-response";
import { requireCurrentUser } from "@/lib/auth-permissions";
import { exportOrdersCsv, type OrderReference } from "@/lib/services/order-service";

export async function POST(request: Request) {
  try {
    await requireCurrentUser(request);
    const input = (await request.json()) as { orders?: OrderReference[] };
    const csv = await exportOrdersCsv(input.orders ?? []);
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="warehouse-orders-${timestamp}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return fail(error, 400);
  }
}
