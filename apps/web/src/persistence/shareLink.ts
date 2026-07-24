import { migrateToLatest, SchemaMigrationError, type Scenario } from "@fp/engine";
import type { ImportFailure, ImportResult } from "./fileExportImport.js";

const SHARE_PARAM = "p";

// Prefixed onto the encoded payload so a decoder never has to guess
// whether the encoder had `CompressionStream` available — encode-time and
// decode-time browser support are independent of each other.
const COMPRESSED_FLAG = "1";
const RAW_FLAG = "0";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const restored = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = restored.padEnd(Math.ceil(restored.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipeThrough(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A `Scenario` is a handful of catalog instances, not per-year data, so
 * this stays small — compressed + base64url, a link lands in the low
 * hundreds to low thousands of characters (SPEC.md §9.2's "no server"
 * means this is the only way to transmit a full plan besides a file).
 * Split out from `buildShareUrl` below so the encode/decode round trip
 * can be tested without a `location` to depend on.
 */
export async function encodeScenarioForShareLink(scenario: Scenario): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(scenario));
  const canCompress = typeof CompressionStream === "function";
  const payload = canCompress ? await pipeThrough(bytes, new CompressionStream("deflate-raw")) : bytes;
  return (canCompress ? COMPRESSED_FLAG : RAW_FLAG) + base64UrlEncode(payload);
}

export async function buildShareUrl(scenario: Scenario): Promise<string> {
  const encoded = await encodeScenarioForShareLink(scenario);
  return `${location.origin}${location.pathname}?${SHARE_PARAM}=${encoded}#/`;
}

/** Reads the `?p=` param without touching `location.hash` (the router's own state). */
export function readShareParam(): string | null {
  return new URLSearchParams(location.search).get(SHARE_PARAM);
}

/** Strips `?p=` so a refresh or navigating back never re-triggers the import prompt. */
export function clearShareParam(): void {
  history.replaceState(null, "", location.pathname + location.hash);
}

/**
 * Reverses `buildShareUrl`, ending in the same `migrateToLatest` schema
 * handling `importScenarioFromFile` uses, so a share link and a `.json`
 * file fail in the same well-defined ways.
 */
export async function decodeShareParam(param: string): Promise<ImportResult | ImportFailure> {
  if (param.length < 1) {
    return { kind: "failure", message: "That link doesn't contain a plan." };
  }

  const flag = param[0];
  let jsonBytes: Uint8Array;
  try {
    const payload = base64UrlDecode(param.slice(1));
    if (flag === COMPRESSED_FLAG) {
      if (typeof DecompressionStream !== "function") {
        return { kind: "failure", message: "That link needs a newer browser to open." };
      }
      jsonBytes = await pipeThrough(payload, new DecompressionStream("deflate-raw"));
    } else {
      jsonBytes = payload;
    }
  } catch {
    return { kind: "failure", message: "That link's plan data is corrupted." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return { kind: "failure", message: "That link's plan data isn't valid." };
  }

  try {
    return { kind: "success", scenario: migrateToLatest(parsed) };
  } catch (error) {
    if (error instanceof SchemaMigrationError) {
      return { kind: "failure", message: error.message };
    }
    return { kind: "failure", message: "That link isn't a recognised shared plan." };
  }
}
