import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";

const script = new URL("../../scripts/generate-card-derivatives.mjs", import.meta.url).pathname;

test("npm run card-images writes the twins, lists exactly those, skips small images and is idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "card-images-"));
  try {
    const big = join(root, "public/images/landing/a");
    const small = join(root, "public/images/landing/b");
    mkdirSync(big, { recursive: true });
    mkdirSync(small, { recursive: true });
    mkdirSync(join(root, "src/data"), { recursive: true });
    const photo = (size: number) =>
      sharp({ create: { width: size, height: size, channels: 3, background: { r: 200, g: 60, b: 30 } } }).webp().toBuffer();
    writeFileSync(join(big, "hero-product.webp"), await photo(600));
    writeFileSync(join(small, "hero-product.webp"), await photo(300));
    const manifest = join(root, "src/data/card-derivatives.ts");
    writeFileSync(manifest, "// head\nexport const CARD_DERIVATIVES: ReadonlySet<string> = new Set<string>([]);\n");

    const run = () => execFileSync("node", [script], { cwd: root, encoding: "utf8" });
    assert.match(run(), /1 written, 1 listed/);

    const twin = await sharp(join(big, "hero-product-sm.webp")).metadata();
    assert.equal(Math.max(twin.width ?? 0, twin.height ?? 0), 480);
    // 300 px is already card-sized: it is its own twin, so nothing is written or listed.
    assert.equal(existsSync(join(small, "hero-product-sm.webp")), false);
    const listed = readFileSync(manifest, "utf8");
    assert.match(listed, /"\/images\/landing\/a\/hero-product\.webp"/);
    assert.doesNotMatch(listed, /landing\/b/);

    assert.match(run(), /0 written, 1 listed/);
    assert.equal(readFileSync(manifest, "utf8"), listed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
