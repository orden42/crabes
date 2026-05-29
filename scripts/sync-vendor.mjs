import { copyFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const copies = [
  ["node_modules/littlejsengine/dist/littlejs.esm.js", "vendor/littlejs.esm.js"],
  ["node_modules/midi.js/lib/midi.min.js", "vendor/midi.min.js"],
];

await mkdir(join(root, "vendor"), { recursive: true });

for (const [src, dest] of copies) {
  await copyFile(join(root, src), join(root, dest));
  console.log(`vendor: ${dest}`);
}
