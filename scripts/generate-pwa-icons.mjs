import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
const root = process.cwd();
await mkdir(resolve(root, "public/placeholder"), { recursive: true });
for (const [name, size] of [["icon-192.png",192],["icon-512.png",512],["icon-maskable-512.png",512]]) {
 await sharp(resolve(root,"public/placeholder/symbol.svg")).resize(size,size).png().toFile(resolve(root,"public/placeholder",name));
}
