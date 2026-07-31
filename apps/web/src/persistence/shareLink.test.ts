import type { Household, Person, Scenario } from "@fp/engine";
import { CURRENT_SCHEMA_VERSION, personId, poundsToPence } from "@fp/engine";
import { describe, expect, it, vi } from "vitest";
import { buildShareUrl, decodeShareParam, encodeScenarioForShareLink } from "./shareLink.js";

const PERSON_ID = personId("p1");
const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };

function makeScenario(): Scenario {
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    household,
    accounts: [
      {
        id: "acc1",
        kind: "pension",
        owner: PERSON_ID,
        pensionType: "sipp",
        currentBalance: poundsToPence(50000),
        annualGrowthRate: 0.05,
        annualChargeRate: 0.0005,
        employerAnnualContribution: poundsToPence(0),
      },
    ],
    incomeSources: [],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

function base64UrlOf(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("shareLink round trip", () => {
  it("decodes exactly what it encoded, migrated up to the current schema version", async () => {
    // decodeShareParam runs decoded data through migrateToLatest (same as every other load path —
    // IndexedDB, file import) — a v1 scenario in comes out as the current version, not preserved
    // as-is, so the round trip's schemaVersion legitimately differs from what was encoded.
    const scenario = makeScenario();
    const param = await encodeScenarioForShareLink(scenario);

    const result = await decodeShareParam(param);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.scenario).toEqual({ ...scenario, schemaVersion: CURRENT_SCHEMA_VERSION });
    }
  });

  it("preserves an explicit assetAllocation.equityMarket unchanged when the scenario is already stamped at CURRENT_SCHEMA_VERSION", async () => {
    // Regression test: Onboarding.tsx used to hardcode `schemaVersion: 1` on every freshly-built
    // scenario regardless of its actual (current) shape, which meant a live in-app scenario with an
    // explicit `equityMarket` choice got wrongly routed through the v1->v2->v3 migration chain (meant
    // only for genuinely old, pre-equityMarket exports) on every share/reload/import, silently
    // resetting "US equities" back to the "UK equities" default via a lossy split-then-tie-break.
    // A scenario correctly stamped at CURRENT_SCHEMA_VERSION must skip migration entirely and survive
    // a share-link round trip byte-for-byte.
    const scenario: Scenario = {
      ...makeScenario(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      accounts: [
        {
          id: "isa1",
          kind: "isa",
          owner: PERSON_ID,
          isaType: "stocksAndShares",
          currentBalance: poundsToPence(100000),
          annualGrowthRate: 0.05,
          assetAllocation: { equities: 0.8, equityMarket: "us", bonds: 0.1, cash: 0.1 },
        },
      ],
    };

    const param = await encodeScenarioForShareLink(scenario);
    const result = await decodeShareParam(param);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.scenario).toEqual(scenario);
    }
  });

  it("builds a URL with the encoded payload in ?p= and the hash route preserved", async () => {
    // vitest's default (non-jsdom) environment has no `location` — this app
    // is a no-server SPA (SPEC.md §9.1), so a plain stub is enough to
    // exercise `buildShareUrl`'s string assembly.
    vi.stubGlobal("location", { origin: "https://canistop.uk", pathname: "/" });
    try {
      const url = await buildShareUrl(makeScenario());
      expect(url).toMatch(/^https:\/\/canistop\.uk\/\?p=[01][A-Za-z0-9\-_]+#\/$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("decodeShareParam failure handling", () => {
  it("fails gracefully on an empty param", async () => {
    const result = await decodeShareParam("");
    expect(result).toEqual({ kind: "failure", message: "That link doesn't contain a plan." });
  });

  it("fails gracefully on garbage base64", async () => {
    const result = await decodeShareParam("1***not-base64***");
    expect(result.kind).toBe("failure");
  });

  it("fails gracefully on well-formed but non-JSON payload", async () => {
    // Flag "0" = uncompressed; base64url of the literal bytes "not json".
    const raw = base64UrlOf("not json");
    const result = await decodeShareParam(`0${raw}`);
    expect(result).toEqual({ kind: "failure", message: "That link's plan data isn't valid." });
  });

  it("surfaces a schema migration failure for an unrecognised shape", async () => {
    const raw = base64UrlOf(JSON.stringify({ schemaVersion: 999_999, nonsense: true }));
    const result = await decodeShareParam(`0${raw}`);
    expect(result.kind).toBe("failure");
  });

  it("reports a friendly message when DecompressionStream is unavailable for a compressed link", async () => {
    const original = globalThis.DecompressionStream;
    // @ts-expect-error -- deliberately simulating an unsupported browser
    globalThis.DecompressionStream = undefined;
    try {
      const result = await decodeShareParam("1AAAA");
      expect(result).toEqual({ kind: "failure", message: "That link needs a newer browser to open." });
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});
