import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, type Person } from "./types.js";
import { splitByOwnership } from "./jointOwnership.js";

const PERSON_A_ID = personId("a");
const PERSON_B_ID = personId("b");
const personA: Person = { id: PERSON_A_ID, dateOfBirth: "1980-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
const personB: Person = { id: PERSON_B_ID, dateOfBirth: "1982-01-01", targetRetirementAge: 67, projectionEndAge: 95 };

describe("splitByOwnership", () => {
  it("attributes the whole amount to a specific owner, regardless of household size", () => {
    expect(splitByOwnership(poundsToPence(1000), PERSON_A_ID, [personA, personB])).toEqual(new Map([[PERSON_A_ID, poundsToPence(1000)]]));
  });

  it("splits a joint amount 50/50 across two people", () => {
    const result = splitByOwnership(poundsToPence(1000), "joint", [personA, personB]);
    expect(result.get(PERSON_A_ID)).toBe(poundsToPence(500));
    expect(result.get(PERSON_B_ID)).toBe(poundsToPence(500));
  });

  it("splits an odd penny amount so the two shares still sum exactly to the total", () => {
    const result = splitByOwnership(poundsToPence(10.01), "joint", [personA, personB]);
    const shareA = result.get(PERSON_A_ID) ?? 0;
    const shareB = result.get(PERSON_B_ID) ?? 0;
    expect(shareA + shareB).toBe(poundsToPence(10.01));
  });

  it("attributes a joint amount entirely to the sole person in a single-person household", () => {
    const result = splitByOwnership(poundsToPence(1000), "joint", [personA]);
    expect(result).toEqual(new Map([[PERSON_A_ID, poundsToPence(1000)]]));
  });

  it("returns an empty map for a joint amount with no people at all", () => {
    expect(splitByOwnership(poundsToPence(1000), "joint", [])).toEqual(new Map());
  });
});
