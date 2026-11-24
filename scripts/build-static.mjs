// Prepara la cartella "public" da pubblicare: pagine di web/ e codice compilato in dist/.
import { cp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const out = join(root, "public");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, "web"), out, { recursive: true });
await cp(join(root, "dist"), join(out, "dist"), { recursive: true, filter: (s) => !s.endsWith(".d.ts") });
console.log("public/ pronta");
