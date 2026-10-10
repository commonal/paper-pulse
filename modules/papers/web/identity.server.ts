import type { AdminMe } from "@aihot/contracts/admin";
import { adminGet } from "@aihot/web/lib/admin.server";
export async function identity(request: Request) { return adminGet<AdminMe>(request, "/api/admin/me"); }
