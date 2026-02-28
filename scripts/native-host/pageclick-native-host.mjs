#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOST_NAME = "com.pageclick.host";
const MAX_READ_BYTES = 1024 * 1024;
const HOME = os.homedir();
const ALLOWED_DIRS = [
  path.resolve(HOME, "Documents"),
  path.resolve(HOME, "Desktop"),
  path.resolve(HOME, "Downloads"),
];

function sendNativeMessage(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function fail(id, error) {
  sendNativeMessage({ ok: false, error, id });
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return HOME;
  if (inputPath.startsWith("~/")) return path.join(HOME, inputPath.slice(2));
  return inputPath;
}

function isPathAllowed(candidate) {
  const resolved = path.resolve(expandHome(candidate));
  return ALLOWED_DIRS.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
}

function clipboardRead() {
  const out = spawnSync("pbpaste", [], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(out.stderr?.trim() || "pbpaste failed");
  }
  return out.stdout || "";
}

function clipboardWrite(text) {
  const out = spawnSync("pbcopy", [], {
    input: String(text ?? ""),
    encoding: "utf8",
  });
  if (out.status !== 0) {
    throw new Error(out.stderr?.trim() || "pbcopy failed");
  }
  return true;
}

function readTextFile(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("fs.readText requires args.path (string)");
  }
  if (!isPathAllowed(filePath)) {
    throw new Error(
      `Path is not allowed. Allowed roots: ${ALLOWED_DIRS.join(", ")}`,
    );
  }
  const resolved = path.resolve(expandHome(filePath));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Target path is not a file");
  if (stat.size > MAX_READ_BYTES)
    throw new Error(`File too large (> ${MAX_READ_BYTES} bytes)`);
  return fs.readFileSync(resolved, "utf8");
}

function handleRequest(request) {
  const id = request?.id;
  if (!request || typeof request !== "object") {
    fail(id, "Invalid request payload");
    return;
  }

  const op = request.op;
  const args = request.args || {};

  try {
    if (op === "clipboard.read") {
      sendNativeMessage({ ok: true, data: { text: clipboardRead() }, id });
      return;
    }
    if (op === "clipboard.write") {
      clipboardWrite(args.text ?? "");
      sendNativeMessage({ ok: true, data: { written: true }, id });
      return;
    }
    if (op === "fs.readText") {
      const content = readTextFile(args.path);
      sendNativeMessage({ ok: true, data: { path: args.path, content }, id });
      return;
    }

    fail(id, `Unsupported operation "${op}"`);
  } catch (err) {
    fail(id, err instanceof Error ? err.message : String(err));
  }
}

let input = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const msgLength = input.readUInt32LE(0);
    if (input.length < 4 + msgLength) break;
    const body = input.subarray(4, 4 + msgLength).toString("utf8");
    input = input.subarray(4 + msgLength);

    try {
      const parsed = JSON.parse(body);
      handleRequest(parsed);
    } catch {
      fail(undefined, `${HOST_NAME}: invalid JSON request`);
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
