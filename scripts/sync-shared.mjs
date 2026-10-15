import { copyFileSync } from "node:fs";
copyFileSync("shared/ai-core.ts", "web/lib/ai-core.ts");
copyFileSync("shared/ai-core.ts", "worker/src/ai-core.ts");
console.log("synced shared/ai-core.ts → web/lib, worker/src");
