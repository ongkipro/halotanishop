import assert from "node:assert/strict";
import { test } from "node:test";
import { homeDescription, homeTitle } from "./home-seo.ts";

test("a tagline that repeats the store name does not repeat it in the title", () => {
  const title = homeTitle("Zvara Shop", "Zvara Shop, toko online perlengkapan rumah tangga, gadget, perawatan diri, dan gaya hidup.");
  assert.ok(title.startsWith("Zvara Shop — toko online"));
  assert.equal(title.match(/Zvara Shop/g)?.length, 1);
  assert.ok(title.length <= 60);
});

test("a short tail is kept whole and a name alone is returned when nothing is left", () => {
  assert.equal(homeTitle("Agritani Store", "Menyediakan kebutuhan pertanian"), "Agritani Store — Menyediakan kebutuhan pertanian");
  assert.equal(homeTitle("Baven", "Baven"), "Baven");
  assert.equal(homeTitle("Baven", ""), "Baven");
});

test("a name too long to leave room for a tail stands alone", () => {
  const name = "Toko Serba Ada Nusantara Jaya Makmur Sentosa Abadi Selalu";
  assert.equal(homeTitle(name, "toko online lengkap"), name);
});

test("a short description gains the store's own categories, deduplicated", () => {
  const text = homeDescription("Belanja online di Agritani Store.", ["Pupuk", "pupuk", "Benih", "Alat"]);
  assert.equal(text, "Belanja online di Agritani Store. Kategori: Pupuk, Benih, Alat.");
});

test("a long description is trimmed at a word and an empty catalogue changes nothing", () => {
  const long = "kata ".repeat(60);
  const out = homeDescription(long, []);
  assert.ok(out.length <= 160 && !out.endsWith(" "));
  assert.equal(homeDescription("Pendek.", []), "Pendek.");
});
