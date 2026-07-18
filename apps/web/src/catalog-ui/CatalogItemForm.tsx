import { pence, penceToPounds, poundsToPence, type CatalogFieldSchema, type Pence, type ValidationIssue } from "@fp/engine";
import { Checkbox, NumberInput, Select, Stack, Text, TextInput } from "@mantine/core";

export interface CatalogItemFormProps<TConfig extends object> {
  readonly fields: readonly CatalogFieldSchema<TConfig>[];
  readonly value: TConfig;
  readonly onChange: (value: TConfig) => void;
  readonly issues?: readonly ValidationIssue[];
}

/**
 * Renders a catalog type's own field schema generically (SPEC.md §3.11,
 * §9.4) — this is the one form component every Income Source/Drain type
 * shares. Adding a new catalog type in a later phase never touches this
 * component; it only ever needs a new `fields` array on that type's own
 * definition.
 */
export function CatalogItemForm<TConfig extends object>({
  fields,
  value,
  onChange,
  issues = [],
}: CatalogItemFormProps<TConfig>) {
  const issueFor = (fieldKey: string): ValidationIssue | undefined => issues.find((i) => i.field === fieldKey);

  return (
    <Stack gap="sm">
      {fields.map((field) => {
        const issue = issueFor(field.key);
        return (
          <div key={field.key}>
            <CatalogFieldInput field={field} value={value[field.key]} onChange={(v) => onChange({ ...value, [field.key]: v })} />
            {issue && (
              <Text size="sm" c={issue.tier === "hardBlock" ? "red" : "yellow.7"}>
                {issue.message}
              </Text>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

function CatalogFieldInput<TConfig>({
  field,
  value,
  onChange,
}: {
  readonly field: CatalogFieldSchema<TConfig>;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  switch (field.input) {
    case "currency":
      // The config value is Pence (SPEC.md §9.6); this is one of the
      // engine's three sanctioned pounds<->pence boundaries — displayed
      // and edited in pounds here, converted back to Pence on change.
      return (
        <NumberInput
          label={field.label}
          required={field.required}
          value={typeof value === "number" ? penceToPounds(pence(value)) : ""}
          onChange={(v) => onChange(poundsToPence(typeof v === "number" ? v : 0) satisfies Pence)}
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
        />
      );
    case "percentage":
      return (
        <NumberInput
          label={field.label}
          required={field.required}
          value={typeof value === "number" ? value * 100 : ""}
          onChange={(v) => onChange(typeof v === "number" ? v / 100 : 0)}
          rightSection="%"
          decimalScale={2}
        />
      );
    case "age":
      return (
        <NumberInput
          label={field.label}
          required={field.required}
          value={typeof value === "number" ? value : ""}
          onChange={(v) => onChange(typeof v === "number" ? v : undefined)}
          min={0}
          max={130}
        />
      );
    case "date":
      return (
        <TextInput
          type="date"
          label={field.label}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    case "select":
      return (
        <Select
          label={field.label}
          required={field.required}
          data={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange(v ?? undefined)}
        />
      );
    case "boolean":
      return (
        <Checkbox label={field.label} checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />
      );
    case "text":
      return (
        <TextInput
          label={field.label}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    default:
      return null;
  }
}
