import { copyFileSync } from "node:fs";
copyFileSync("shared/ai-core.ts", "web/lib/ai-core.ts");
copyFileSync("shared/ai-core.ts", "worker/src/ai-core.ts");
copyFileSync("shared/tg-auth.ts", "web/lib/tg-auth.ts");
copyFileSync("shared/tg-auth.ts", "worker/src/tg-auth.ts");
console.log("synced shared/* → web/lib, worker/src");
