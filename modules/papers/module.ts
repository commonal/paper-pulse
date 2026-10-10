import { defineModule } from "@aihot/contracts/modules";
export default defineModule({
  name: "papers",
  pages: [
    { path: "papers/mine", file: "web/mine.tsx" },
    { path: "papers/library", file: "web/home.tsx", id:'papers-library' },
    { path: "papers/history", file: "web/home.tsx", id:'papers-history' },
    { path: "papers/candidates", file: "web/candidates.tsx" },
    { path: "papers/trends", file: "web/trends.tsx" },
    { path: "papers/impact", file: "web/impact.tsx" },
    { path: "papers/settings", file: "web/settings.tsx" },
    { path: "papers/evaluation", file: "web/evaluation.tsx" },
    { path: "papers/new", file: "web/new.tsx" },
    { path: "papers/:id", file: "web/detail.tsx" },
  ],
  apiPaths: [/^\/api\/admin\/papers(?:\/|$)/],
});
