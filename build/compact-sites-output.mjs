import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await rm(resolve("dist", "standalone"), { recursive: true, force: true });
