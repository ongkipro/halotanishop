// The `adsbook` CLI (PRD A45, REQ-260; docs/OPS-API.md). Logic lives in
// src/lib/adsbook-cli.ts; this file only connects it to the process.
//
//   npm run adsbook -- login --url https://toko.example
//   npm run adsbook -- orders list --status pending --json
import os from "node:os";
import { runAdsbookCli } from "../src/lib/adsbook-cli.ts";

async function readSecret(prompt: string) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text;
  }
  // Raw mode reads the key without echoing it to the terminal.
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise<string>((resolve) => {
    let value = "";
    const onData = (input: string) => {
      for (const char of input) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.off("data", onData);
          stdin.pause();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

process.exitCode = await runAdsbookCli({
  argv: process.argv.slice(2),
  home: os.homedir(),
  fetch,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readSecret,
});
