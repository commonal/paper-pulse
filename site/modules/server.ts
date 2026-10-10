// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";

import papers from "../../modules/papers/server.ts";
export const SERVER_MODULES: readonly ServerModule[] = [papers];
