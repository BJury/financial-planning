import { Group, NumberInput, SegmentedControl, TextInput } from "@mantine/core";
import { useState } from "react";

/** A person's ISO birthday date once they turn `age` — the display-only inverse of `ageFromIsoDate`, used by `AgeOrDateInput`. Whole years only, birthday-precise (not the coarser tax-year-based `ageAtYear` the engine itself uses for `isActive` checks). */
export function isoDateFromAge(dateOfBirth: string, age: number): string {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return "";
  const result = new Date(Date.UTC(dob.getUTCFullYear() + age, dob.getUTCMonth(), dob.getUTCDate()));
  return result.toISOString().slice(0, 10);
}

export function ageFromIsoDate(dateOfBirth: string, date: string): number | undefined {
  const dob = new Date(dateOfBirth);
  const d = new Date(date);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(d.getTime())) return undefined;
  let age = d.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayYet = d.getUTCMonth() > dob.getUTCMonth() || (d.getUTCMonth() === dob.getUTCMonth() && d.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayYet) age -= 1;
  return age;
}

/**
 * Most people think about a plan in terms of their own age, not a
 * calendar date — this lets any date tied to a specific person be
 * entered either way via a small toggle in the label, while the
 * `Scenario` schema itself always stores a plain ISO date underneath
 * (no schema/engine change needed; this is purely a display convenience).
 * Falls back to date-only when no owning person's date of birth is
 * known yet (e.g. a joint item, or before DOB is filled in) — an age is
 * meaningless without a birthday to count from. Shared by both
 * `Onboarding.tsx` (generic instance scheduling, Property's purchase/sale
 * dates) and `catalog-ui/CatalogItemForm.tsx` (a catalog type's own
 * `"date"`-typed fields, e.g. a one-off inflow's date).
 */
export function AgeOrDateInput({
  label,
  description,
  value,
  dateOfBirth,
  defaultMode = "date",
  required,
  defaultIsoDate,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly dateOfBirth: string | undefined;
  /** Which toggle position this field starts in — e.g. State Pension's own "Starts on" defaults to "age" (pre-filled at 67) since that's how the field is naturally thought about, unlike most other date-tied fields, which default to a plain date. */
  readonly defaultMode?: "date" | "age";
  readonly required?: boolean;
  /**
   * What this field actually resolves to when left blank (e.g. a
   * contribution's "Ends on" falling back to the drawdown target's start
   * age) — shown only as ghost placeholder text, never written into
   * `value` itself. Keeping it out of `value` matters: a resolved default
   * used to be indistinguishable from a real, explicitly-set one (same
   * solid text, same colour), which is why clearing the field back to
   * blank looked like nothing had changed. A placeholder reads as
   * unset-but-implied instead, the same way every other empty input on
   * this page already looks.
   */
  readonly defaultIsoDate?: string;
  readonly onChange: (isoDate: string) => void;
}) {
  const [mode, setMode] = useState<"date" | "age">(defaultMode);
  const canUseAge = Boolean(dateOfBirth);

  const labelNode = (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <span>{label}</span>
      {canUseAge && (
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v === "age" ? "age" : "date")}
          data={[
            { label: "Date", value: "date" },
            { label: "Age", value: "age" },
          ]}
        />
      )}
    </Group>
  );

  if (mode === "age" && canUseAge && dateOfBirth) {
    const ageValue = value ? ageFromIsoDate(dateOfBirth, value) : undefined;
    const placeholderAge = ageValue === undefined && defaultIsoDate ? ageFromIsoDate(dateOfBirth, defaultIsoDate) : undefined;
    return (
      <NumberInput
        label={labelNode}
        description={description}
        {...(required !== undefined ? { required } : {})}
        {...(ageValue !== undefined ? { value: ageValue } : {})}
        {...(placeholderAge !== undefined ? { placeholder: String(placeholderAge) } : {})}
        onChange={(v) => onChange(typeof v === "number" ? isoDateFromAge(dateOfBirth, v) : "")}
      />
    );
  }

  return (
    <TextInput
      type="date"
      label={labelNode}
      description={description}
      {...(required !== undefined ? { required } : {})}
      value={value}
      {...(!value && defaultIsoDate ? { placeholder: defaultIsoDate } : {})}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}
