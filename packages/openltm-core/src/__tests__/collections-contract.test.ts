/**
 * The shared collections contract: core and the Hermes plugin (Python) both
 * run every case in fixtures/collections-contract.json. A failure here means
 * core drifted from the contract; regenerate the fixture only on a deliberate
 * change, and port the change to hermes/openltm_hermes/_collections.py.
 */
import { describe, expect, test } from "bun:test";
import contract from "./fixtures/collections-contract.json";
import {
  LIMITS, NAME_RE, RESERVED_FIELD_NAMES, buildRecordSchema, buildSearchText, checkKeyField,
  diffFields, fieldListSchema, isAuthorityLike, looksSimilar, type FieldSpec,
} from "../collections/fieldSpec.js";
import {
  COLLECTION_ACTIONS, COLLECTION_ORIGINS, COLLECTION_TOOL_DESCRIPTION, FIELD_TYPES, FILTER_OPS,
  RECORD_ACTIONS, RECORD_TOOL_DESCRIPTION,
} from "../collections/toolSchema.js";

const fields = (x: unknown) => x as FieldSpec[];

describe("collections contract", () => {
  test("constants and tool descriptions", () => {
    expect([...FIELD_TYPES]).toEqual(contract.field_types);
    expect([...FILTER_OPS]).toEqual(contract.filter_ops);
    expect([...COLLECTION_ORIGINS]).toEqual(contract.collection_origins);
    expect([...COLLECTION_ACTIONS]).toEqual(contract.collection_actions);
    expect([...RECORD_ACTIONS]).toEqual(contract.record_actions);
    expect({ ...LIMITS }).toEqual(contract.limits);
    expect([...RESERVED_FIELD_NAMES].sort()).toEqual(contract.reserved_field_names);
    expect(COLLECTION_TOOL_DESCRIPTION).toBe(contract.collection_tool_description);
    expect(RECORD_TOOL_DESCRIPTION).toBe(contract.record_tool_description);
  });

  test.each(contract.names)("name %j", ({ name, valid }) => expect(NAME_RE.test(name)).toBe(valid));
  test.each(contract.field_definitions.map((c, i) => [i, c] as const))("field definition #%d", (_, c) => {
    expect(fieldListSchema.safeParse(c.fields).success).toBe(c.valid);
  });
  test.each(contract.key_fields.map((c, i) => [i, c] as const))("key field #%d", (_, c) => {
    expect(checkKeyField(fields(c.fields), c.key) === null).toBe(c.valid);
  });
  test.each(contract.records.map((c, i) => [i, c] as const))("record #%d", (_, c) => {
    expect(buildRecordSchema(fields(contract.record_fields)).safeParse(c.data).success).toBe(c.valid);
  });
  test.each(contract.similar)("similar $a / $b", (c) => {
    expect(looksSimilar(c.a, fields(c.a_fields), c.b, fields(c.b_fields))).toBe(c.similar);
  });
  test.each(contract.authority)("authority-like $name", ({ name, authority }) => expect(isAuthorityLike(name)).toBe(authority));
  test.each(contract.diffs.map((c, i) => [i, c] as const))("diff #%d", (_, c) => {
    const d = diffFields(fields(c.old), fields(c.new));
    expect([d.breaking.length, d.searchChanged]).toEqual([c.breaking, c.search_changed]);
  });
  test.each(contract.search_text)("search text for $collection", (c) => {
    expect(buildSearchText(c.collection, fields(c.fields), c.data as Record<string, unknown>, c.key)).toBe(c.text);
  });
});
