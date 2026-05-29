import { fail, ok } from "@/lib/api-response";
import { login, type LoginInput } from "@/lib/services/auth-service";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as LoginInput;
    return ok(await login(input));
  } catch (error) {
    return fail(error, 401);
  }
}
