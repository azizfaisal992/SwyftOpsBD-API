import assert from "node:assert/strict";
import test from "node:test";
import { readRequiredString, requireObjectBody } from "./index.js";

test("requires a JSON object body", () => {
  assert.throws(() => requireObjectBody(null), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
  assert.throws(() => requireObjectBody([]), /JSON object/);
});

test("reads and trims required strings", () => {
  assert.equal(readRequiredString({ name: "  Sarah  " }, "name"), "Sarah");
});

test("reports field-specific required and maximum-length errors", () => {
  assert.throws(() => readRequiredString({}, "name"), (error) => {
    assert.equal(error.fields.name, "name is required.");
    return true;
  });
  assert.throws(
    () => readRequiredString({ name: "abcd" }, "name", { maxLength: 3 }),
    (error) => {
      assert.match(error.fields.name, /3 characters/);
      return true;
    },
  );
});
