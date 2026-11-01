#!/usr/bin/env node
// Regenerate public/data/google-product-taxonomy.json from Google's official
// taxonomy file — the list behind `g:google_product_category`, which Meta's
// catalog accepts too.
//
//   node scripts/generate-google-taxonomy.mjs [path-or-url]
//
// Google publishes it with ids in US English only; an id-ID file answers 404.
// The admin picker searches it in the browser (with Indonesian aliases, see
// src/lib/google-taxonomy.ts). It is a static asset rather than a D1 table:
// the list is identical for every install and changes only when Google
// releases a version, and seeding ~5,600 rows would cost every install writes.
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt";
const arg = process.argv[2] || SOURCE;
const text = /^https?:/.test(arg) ? await (await fetch(arg)).text() : readFileSync(arg, "utf8");

const version = text.match(/^# Google_Product_Taxonomy_Version: (\S+)/m)?.[1];
if (!version) throw new Error("Not a Google product taxonomy file (no version header).");
const rows = [];
for (const line of text.split("\n")) {
  const match = line.match(/^(\d+) - (.+)$/);
  if (match) rows.push([Number(match[1]), match[2].trim()]);
}
if (rows.length < 5000) throw new Error(`Only ${rows.length} categories parsed; refusing to write a partial list.`);
const out = new URL("../public/data/google-product-taxonomy.json", import.meta.url);
writeFileSync(out, JSON.stringify({ version, source: SOURCE, categories: rows }));
console.log(`${rows.length} categories (version ${version}) -> public/data/google-product-taxonomy.json`);
