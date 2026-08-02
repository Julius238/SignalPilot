import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DECIMAL_PRECISION,
  DECIMAL_SCALE,
  DecimalValue,
  RoundingMode,
  TradingDomainError,
  TradingReasonCode,
  decimal
} from "../src/index.js";

const expectReason = (reasonCode: string, run: () => unknown): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof TradingDomainError, `expected TradingDomainError, got ${String(error)}`);
    assert.equal(error.reasonCode, reasonCode);
    return true;
  });
};

describe("DecimalValue — parsing and canonical form", () => {
  it("matches the Decimal(30,12) column definition", () => {
    assert.equal(DECIMAL_SCALE, 12);
    assert.equal(DECIMAL_PRECISION, 30);
  });

  it("renders every value with exactly 12 fractional digits", () => {
    assert.equal(decimal("0").toString(), "0.000000000000");
    assert.equal(decimal("1").toString(), "1.000000000000");
    assert.equal(decimal("0.0025").toString(), "0.002500000000");
    assert.equal(decimal("-123.456").toString(), "-123.456000000000");
    assert.equal(decimal("60000.123456789012").toString(), "60000.123456789012");
  });

  it("treats -0 as 0", () => {
    assert.equal(decimal("-0").toString(), "0.000000000000");
    assert.ok(decimal("-0").isZero());
    assert.equal(decimal("-0").isNegative(), false);
  });

  it("trims only for display, never for hashing", () => {
    assert.equal(decimal("1.500").toCompactString(), "1.5");
    assert.equal(decimal("100").toCompactString(), "100");
    assert.equal(decimal("0").toCompactString(), "0");
    assert.equal(decimal("1.500").toString(), "1.500000000000");
  });

  it("serialises to its canonical string in JSON", () => {
    assert.equal(JSON.stringify({ price: decimal("42.5") }), '{"price":"42.500000000000"}');
  });

  it("rejects anything that is not a plain decimal string", () => {
    for (const bad of ["", " 1", "1 ", "1e3", "1E3", "+1", "0x10", ".5", "5.", "1,5", "abc", "--1", "Infinity", "NaN"]) {
      expectReason(TradingReasonCode.DECIMAL_INVALID_FORMAT, () => decimal(bad));
    }
  });

  it("rejects more than 12 fractional digits instead of rounding silently", () => {
    expectReason(TradingReasonCode.DECIMAL_SCALE_EXCEEDED, () => decimal("0.1234567890123"));
    assert.equal(decimal("0.123456789012").toString(), "0.123456789012");
  });

  it("rejects values beyond the 30 digit precision", () => {
    const maximum = "9".repeat(DECIMAL_PRECISION - DECIMAL_SCALE) + "." + "9".repeat(DECIMAL_SCALE);
    assert.equal(decimal(maximum).toString(), maximum);
    expectReason(TradingReasonCode.DECIMAL_PRECISION_EXCEEDED, () =>
      decimal("1" + "0".repeat(DECIMAL_PRECISION - DECIMAL_SCALE) + ".0")
    );
    expectReason(TradingReasonCode.DECIMAL_PRECISION_EXCEEDED, () => decimal(maximum).add(decimal("0.000000000001")));
  });
});

describe("DecimalValue — no JavaScript float may enter", () => {
  it("has no fromNumber constructor", () => {
    assert.equal("fromNumber" in DecimalValue, false);
  });

  it("accepts integers but refuses fractional numbers", () => {
    assert.equal(DecimalValue.fromSafeInteger(10_000).toString(), "10000.000000000000");
    assert.equal(DecimalValue.fromSafeInteger(-3n).toString(), "-3.000000000000");
    expectReason(TradingReasonCode.DECIMAL_FLOAT_INPUT_FORBIDDEN, () => DecimalValue.fromSafeInteger(0.1));
    expectReason(TradingReasonCode.DECIMAL_FLOAT_INPUT_FORBIDDEN, () => DecimalValue.fromSafeInteger(Number.NaN));
    expectReason(TradingReasonCode.DECIMAL_FLOAT_INPUT_FORBIDDEN, () =>
      DecimalValue.fromSafeInteger(Number.MAX_SAFE_INTEGER + 2)
    );
  });

  it("converts basis points into an exact decimal rate", () => {
    assert.equal(DecimalValue.fromBasisPoints(10).toCompactString(), "0.001");
    assert.equal(DecimalValue.fromBasisPoints(20).toCompactString(), "0.002");
    assert.equal(DecimalValue.fromBasisPoints(15).toCompactString(), "0.0015");
    assert.equal(DecimalValue.fromBasisPoints(0).isZero(), true);
  });

  it("keeps precision where a float would drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754.
    assert.equal(decimal("0.1").add(decimal("0.2")).toString(), decimal("0.3").toString());
    // 0.07 * 3 would be 0.21000000000000002 as a float.
    assert.equal(decimal("0.07").mul(decimal("3")).toCompactString(), "0.21");
  });

  it("recognises valid decimal strings", () => {
    assert.equal(DecimalValue.isDecimalString("1.5"), true);
    assert.equal(DecimalValue.isDecimalString("1.5000000000001"), false);
    assert.equal(DecimalValue.isDecimalString(1.5 as unknown), false);
  });
});

describe("DecimalValue — arithmetic and rounding", () => {
  it("adds and subtracts exactly", () => {
    assert.equal(decimal("10000").sub(decimal("25")).toCompactString(), "9975");
    assert.equal(DecimalValue.sum([decimal("1.1"), decimal("2.2"), decimal("3.3")]).toCompactString(), "6.6");
    assert.equal(DecimalValue.sum([]).isZero(), true);
  });

  it("refuses to round unless the caller asks for it", () => {
    expectReason(TradingReasonCode.DECIMAL_ROUNDING_REQUIRED, () => decimal("1").div(decimal("3")));
    expectReason(TradingReasonCode.DECIMAL_ROUNDING_REQUIRED, () =>
      decimal("0.000000000001").mul(decimal("0.5"))
    );
    assert.equal(decimal("1").div(decimal("4")).toCompactString(), "0.25");
  });

  it("rounds in the requested direction, also for negative values", () => {
    const third = () => decimal("1").div(decimal("3"), RoundingMode.FLOOR);
    assert.equal(third().toString(), "0.333333333333");
    assert.equal(decimal("1").div(decimal("3"), RoundingMode.CEIL).toString(), "0.333333333334");
    assert.equal(decimal("-1").div(decimal("3"), RoundingMode.FLOOR).toString(), "-0.333333333334");
    assert.equal(decimal("-1").div(decimal("3"), RoundingMode.CEIL).toString(), "-0.333333333333");
    assert.equal(decimal("-1").div(decimal("3"), RoundingMode.TRUNCATE).toString(), "-0.333333333333");
    assert.equal(decimal("2").div(decimal("3"), RoundingMode.HALF_UP).toString(), "0.666666666667");
    assert.equal(decimal("-2").div(decimal("3"), RoundingMode.HALF_UP).toString(), "-0.666666666667");
  });

  it("rounds a tie away from zero with HALF_UP", () => {
    // 0.000000000005 * 0.1 is exactly half of the smallest representable unit.
    const halfUnit = DecimalValue.fromUnscaled(5n);
    assert.equal(halfUnit.mul(decimal("0.1"), RoundingMode.HALF_UP).toString(), "0.000000000001");
    assert.equal(halfUnit.negate().mul(decimal("0.1"), RoundingMode.HALF_UP).toString(), "-0.000000000001");
    assert.equal(halfUnit.mul(decimal("0.1"), RoundingMode.TRUNCATE).isZero(), true);
  });

  it("refuses division by zero", () => {
    expectReason(TradingReasonCode.DECIMAL_DIVISION_BY_ZERO, () => decimal("1").div(DecimalValue.ZERO));
  });

  it("negates and takes absolute values", () => {
    assert.equal(decimal("-5.5").abs().toCompactString(), "5.5");
    assert.equal(decimal("5.5").negate().toCompactString(), "-5.5");
    assert.equal(DecimalValue.ZERO.negate().isNegative(), false);
  });
});

describe("DecimalValue — step quantisation", () => {
  const stepSize = decimal("0.001");
  const tickSize = decimal("0.01");

  it("floors a quantity to the step size", () => {
    assert.equal(decimal("0.1234").quantizeToStep(stepSize, RoundingMode.FLOOR).toCompactString(), "0.123");
    assert.equal(decimal("0.0009").quantizeToStep(stepSize, RoundingMode.FLOOR).isZero(), true);
  });

  it("ceils an adverse price to the tick size", () => {
    assert.equal(decimal("60000.121").quantizeToStep(tickSize, RoundingMode.CEIL).toCompactString(), "60000.13");
    assert.equal(decimal("60000.121").quantizeToStep(tickSize, RoundingMode.FLOOR).toCompactString(), "60000.12");
  });

  it("leaves an exact multiple untouched in every mode", () => {
    for (const mode of [RoundingMode.FLOOR, RoundingMode.CEIL, RoundingMode.EXACT, RoundingMode.HALF_UP]) {
      assert.equal(decimal("0.123").quantizeToStep(stepSize, mode).toCompactString(), "0.123");
    }
  });

  it("reports whether a value sits on the step grid", () => {
    assert.equal(decimal("0.123").isMultipleOf(stepSize), true);
    assert.equal(decimal("0.1234").isMultipleOf(stepSize), false);
  });

  it("refuses a non-positive step", () => {
    expectReason(TradingReasonCode.DECIMAL_INVALID_STEP, () =>
      decimal("1").quantizeToStep(DecimalValue.ZERO, RoundingMode.FLOOR)
    );
    expectReason(TradingReasonCode.DECIMAL_INVALID_STEP, () => decimal("1").isMultipleOf(decimal("-0.1")));
  });
});

describe("DecimalValue — comparison and immutability", () => {
  it("compares without floating point ambiguity", () => {
    assert.equal(decimal("2.0").eq(decimal("2")), true);
    assert.equal(decimal("1.9999").lt(decimal("2")), true);
    assert.equal(decimal("2").gte(decimal("2")), true);
    assert.equal(decimal("-1").compare(decimal("1")), -1);
    assert.equal(decimal("1").compare(decimal("1")), 0);
    assert.equal(DecimalValue.min(decimal("1"), decimal("2")).toCompactString(), "1");
    assert.equal(DecimalValue.max(decimal("1"), decimal("2")).toCompactString(), "2");
  });

  it("never mutates an operand", () => {
    const base = decimal("10");
    const other = decimal("3");
    base.add(other);
    base.sub(other);
    base.mul(other);
    assert.equal(base.toCompactString(), "10");
    assert.equal(other.toCompactString(), "3");
    assert.equal(Object.isFrozen(base), true);
  });
});
