// Writes a card-sized twin (`<name>-sm.webp`, 480 px long edge) beside every
// static image that matches the patterns, and rewrites src/data/card-derivatives.ts
// with the list `cardImageSrc` may swap. Run it after adding or replacing an
// image under public/images, then commit the twins and the list.
//
//   npm run card-images                      # public/images/landing/*/hero-product.webp
//   npm run card-images -- public/images/shop/*.webp
//
// lazy: `sharp` is Astro's own image dependency, so it is not declared here; if
// Astro ever drops it, add it as a devDependency.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";

const EDGE = 480;
// 66, not 74: on 12 real 600 px packshots 74 averaged 32 KB and 66 averaged 30 KB
// with no visible loss at 182 CSS px; the originals averaged 52 KB.
const QUALITY = 66;
const root = process.cwd();
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : ["public/images/landing/*/hero-product.webp"];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const toRegExp = (glob) =>
  new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");

const everything = walk(join(root, "public")).map((file) => relative(root, file).split("\\").join("/"));
const sources = everything.filter(
  (file) => !/-sm\.[a-z0-9]+$/i.test(file) && patterns.some((glob) => toRegExp(glob).test(file)),
);

const listed = [];
const retired = new Set();
let written = 0;
for (const source of sources.sort()) {
  const twin = source.replace(/(\.[a-z0-9]+)$/i, "-sm$1");
  const fresh = (() => {
    try {
      return statSync(twin).mtimeMs >= statSync(source).mtimeMs;
    } catch {
      return false;
    }
  })();
  if (!fresh) {
    const meta = await sharp(source).metadata();
    // Never enlarge: an image already at card size is its own twin. If the
    // source was replaced by a smaller image, the old twin shows the PREVIOUS
    // picture, so it goes (the wrong-product-content class in AGENTS.md §3).
    if (Math.max(meta.width ?? 0, meta.height ?? 0) <= EDGE) {
      if (existsSync(twin)) unlinkSync(twin);
      retired.add("/" + source.replace(/^public\//, ""));
      continue;
    }
    await sharp(source).resize({ width: EDGE, height: EDGE, fit: "inside" }).webp({ quality: QUALITY, effort: 6 }).toFile(twin);
    written++;
  }
  listed.push("/" + source.replace(/^public\//, ""));
}

// Merge with what is already listed, so running with a narrower pattern does
// not forget the other twins.
const manifest = join(root, "src/data/card-derivatives.ts");
const current = readFileSync(manifest, "utf8");
const previous = [...current.matchAll(/"(\/[^"]+)"/g)].map((match) => match[1]);
const twinOf = (path) => path.replace(/(\.[a-z0-9]+)$/i, "-sm$1");
// Judged on disk after the loop: `everything` was read before the twins were
// written, so filtering on it dropped every twin made in this very run.
// lazy: freshness is mtime (twin >= source). A checkout rewrites every mtime, so the
// twins are re-encoded once to identical bytes; a source restored with `cp -p` can
// look older than a stale twin. Upgrade path: store a source hash beside the list.
const all = [...new Set([...previous, ...listed])].filter((path) => !retired.has(path) && existsSync(join(root, "public", twinOf(path)))).sort();
const head = current.slice(0, current.indexOf("export const CARD_DERIVATIVES"));
writeFileSync(
  manifest,
  head +
    "export const CARD_DERIVATIVES: ReadonlySet<string> = new Set<string>([" +
    (all.length ? "\n" + all.map((path) => `  "${path}",`).join("\n") + "\n" : "") +
    "]);\n",
);
console.log(`card-images: ${written} written, ${all.length} listed in ${relative(root, manifest)}`);
