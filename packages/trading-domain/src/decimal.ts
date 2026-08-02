/**
 * Fixed-point decimal for money, prices, quantities, rates, fees and P&L.
 *
 * Specification: docs/trading/03-domain-model.md, "Modellierungsregeln":
 *   Decimal(30,12), never Float. Percentages are stored as decimal rates
 *   (`0.0025` = 0.25 %); basis points stay Integer inside versioned execution
 *   profiles.
 *
 * The value is carried as a BigInt scaled by 10^12, so no operation ever passes
 * through an IEEE-754 double. There is deliberately no `fromNumber`: a JS float
 * can only enter through `fromSafeInteger`, which rejects anything fractional.
 */

import { TradingDomainError, TradingReasonCode, type DecimalString } from "./types.js";

/** Fractional digits — matches `@db.Decimal(30, 12)`. */
export const DECIMAL_SCALE = 12;

/** Total significant digits — matches `@db.Decimal(30, 12)`. */
export const DECIMAL_PRECISION = 30;

const SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE);
const MAX_UNSCALED = 10n ** BigInt(DECIMAL_PRECISION) - 1n;

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * Rounding behaviour. `EXACT` is the default everywhere: a value that cannot be
 * represented without loss raises instead of silently rounding, which keeps
 * money arithmetic fail-closed. `FLOOR`/`CEIL` are the directional modes the
 * later simulation package needs for adverse rounding (docs/trading/07).
 */
export const RoundingMode = {
  /** Refuse to round; raise `DECIMAL_ROUNDING_REQUIRED`. */
  EXACT: "EXACT",
  /** Toward negative infinity. */
  FLOOR: "FLOOR",
  /** Toward positive infinity. */
  CEIL: "CEIL",
  /** Toward zero. */
  TRUNCATE: "TRUNCATE",
  /** Nearest, ties away from zero. */
  HALF_UP: "HALF_UP"
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

function divideWithRounding(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new TradingDomainError(
      TradingReasonCode.DECIMAL_DIVISION_BY_ZERO,
      "Division by zero is not defined for decimal values."
    );
  }

  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const quotient = n / d;
  const remainder = n % d;
  if (remainder === 0n) return quotient;

  switch (mode) {
    case RoundingMode.EXACT:
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_ROUNDING_REQUIRED,
        `Result is not representable with scale ${DECIMAL_SCALE}; pass an explicit rounding mode.`
      );
    case RoundingMode.TRUNCATE:
      return quotient;
    case RoundingMode.FLOOR:
      return n < 0n ? quotient - 1n : quotient;
    case RoundingMode.CEIL:
      return n > 0n ? quotient + 1n : quotient;
    case RoundingMode.HALF_UP: {
      const doubledRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
      if (doubledRemainder < d) return quotient;
      return n < 0n ? quotient - 1n : quotient + 1n;
    }
    default:
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_INVALID_FORMAT,
        `Unknown rounding mode: ${String(mode)}`
      );
  }
}

function assertWithinPrecision(unscaled: bigint): bigint {
  const magnitude = unscaled < 0n ? -unscaled : unscaled;
  if (magnitude > MAX_UNSCALED) {
    throw new TradingDomainError(
      TradingReasonCode.DECIMAL_PRECISION_EXCEEDED,
      `Value exceeds Decimal(${DECIMAL_PRECISION}, ${DECIMAL_SCALE}).`
    );
  }
  return unscaled;
}

/** Immutable fixed-point decimal at scale 12. */
export class DecimalValue {
  /** Value multiplied by 10^12. */
  readonly unscaled: bigint;

  private constructor(unscaled: bigint) {
    this.unscaled = assertWithinPrecision(unscaled);
    Object.freeze(this);
  }

  // ── Construction ─────────────────────────────────────────────────────────

  /** Parse a plain decimal string. Exponent notation and whitespace are rejected. */
  static fromString(value: string): DecimalValue {
    if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_INVALID_FORMAT,
        `Not a plain decimal string: ${JSON.stringify(value)}`
      );
    }

    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integerPart, fractionPart = ""] = unsigned.split(".");

    if (fractionPart.length > DECIMAL_SCALE) {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_SCALE_EXCEEDED,
        `More than ${DECIMAL_SCALE} fractional digits: ${value}`
      );
    }

    const padded = fractionPart.padEnd(DECIMAL_SCALE, "0");
    const unscaled = BigInt(integerPart + padded);
    return new DecimalValue(negative ? -unscaled : unscaled);
  }

  /** Build from an already scaled BigInt (value × 10^12). */
  static fromUnscaled(unscaled: bigint): DecimalValue {
    if (typeof unscaled !== "bigint") {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_INVALID_FORMAT,
        "fromUnscaled expects a bigint."
      );
    }
    return new DecimalValue(unscaled);
  }

  /** Build from an integer. Any fractional JS number is refused outright. */
  static fromSafeInteger(value: number | bigint): DecimalValue {
    if (typeof value === "bigint") return new DecimalValue(value * SCALE_FACTOR);
    if (!Number.isSafeInteger(value)) {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_FLOAT_INPUT_FORBIDDEN,
        "Money and quantities must not originate from a fractional JavaScript number."
      );
    }
    return new DecimalValue(BigInt(value) * SCALE_FACTOR);
  }

  /** Convert integer basis points into a decimal rate (`20` → `0.002`). */
  static fromBasisPoints(basisPoints: number | bigint): DecimalValue {
    const asInteger = DecimalValue.fromSafeInteger(basisPoints);
    return DecimalValue.fromUnscaled(asInteger.unscaled / 10_000n);
  }

  static readonly ZERO = DecimalValue.fromUnscaled(0n);
  static readonly ONE = DecimalValue.fromUnscaled(SCALE_FACTOR);

  /** True when the string round-trips through `fromString` unchanged in value. */
  static isDecimalString(value: unknown): value is DecimalString {
    if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) return false;
    const fraction = value.split(".")[1] ?? "";
    return fraction.length <= DECIMAL_SCALE;
  }

  static sum(values: readonly DecimalValue[]): DecimalValue {
    return values.reduce<DecimalValue>((total, value) => total.add(value), DecimalValue.ZERO);
  }

  static min(a: DecimalValue, b: DecimalValue): DecimalValue {
    return a.lte(b) ? a : b;
  }

  static max(a: DecimalValue, b: DecimalValue): DecimalValue {
    return a.gte(b) ? a : b;
  }

  // ── Arithmetic ───────────────────────────────────────────────────────────

  add(other: DecimalValue): DecimalValue {
    return new DecimalValue(this.unscaled + other.unscaled);
  }

  sub(other: DecimalValue): DecimalValue {
    return new DecimalValue(this.unscaled - other.unscaled);
  }

  /** Multiplication rounds only when the caller allows it. */
  mul(other: DecimalValue, mode: RoundingMode = RoundingMode.EXACT): DecimalValue {
    return new DecimalValue(divideWithRounding(this.unscaled * other.unscaled, SCALE_FACTOR, mode));
  }

  /** Division rounds only when the caller allows it. */
  div(other: DecimalValue, mode: RoundingMode = RoundingMode.EXACT): DecimalValue {
    return new DecimalValue(divideWithRounding(this.unscaled * SCALE_FACTOR, other.unscaled, mode));
  }

  negate(): DecimalValue {
    return new DecimalValue(-this.unscaled);
  }

  abs(): DecimalValue {
    return this.unscaled < 0n ? this.negate() : this;
  }

  /**
   * Snap to a multiple of `step` (tick size, step size, quote unit).
   * `FLOOR` is the conservative choice for quantities, `CEIL` for fees.
   */
  quantizeToStep(step: DecimalValue, mode: RoundingMode): DecimalValue {
    if (step.unscaled <= 0n) {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_INVALID_STEP,
        "Quantization step must be greater than zero."
      );
    }
    const units = divideWithRounding(this.unscaled, step.unscaled, mode);
    return new DecimalValue(units * step.unscaled);
  }

  /** True when the value sits exactly on a multiple of `step`. */
  isMultipleOf(step: DecimalValue): boolean {
    if (step.unscaled <= 0n) {
      throw new TradingDomainError(
        TradingReasonCode.DECIMAL_INVALID_STEP,
        "Quantization step must be greater than zero."
      );
    }
    return this.unscaled % step.unscaled === 0n;
  }

  // ── Comparison ───────────────────────────────────────────────────────────

  compare(other: DecimalValue): -1 | 0 | 1 {
    if (this.unscaled < other.unscaled) return -1;
    if (this.unscaled > other.unscaled) return 1;
    return 0;
  }

  eq(other: DecimalValue): boolean {
    return this.unscaled === other.unscaled;
  }

  lt(other: DecimalValue): boolean {
    return this.unscaled < other.unscaled;
  }

  lte(other: DecimalValue): boolean {
    return this.unscaled <= other.unscaled;
  }

  gt(other: DecimalValue): boolean {
    return this.unscaled > other.unscaled;
  }

  gte(other: DecimalValue): boolean {
    return this.unscaled >= other.unscaled;
  }

  isZero(): boolean {
    return this.unscaled === 0n;
  }

  isNegative(): boolean {
    return this.unscaled < 0n;
  }

  isPositive(): boolean {
    return this.unscaled > 0n;
  }

  // ── Serialisation ────────────────────────────────────────────────────────

  /**
   * Canonical representation: sign, integer part, dot, exactly 12 fractional
   * digits. Unambiguous for hashing and byte-identical to what PostgreSQL
   * stores in `Decimal(30,12)`.
   */
  toString(): DecimalString {
    const negative = this.unscaled < 0n;
    const magnitude = (negative ? -this.unscaled : this.unscaled).toString().padStart(DECIMAL_SCALE + 1, "0");
    const integerPart = magnitude.slice(0, magnitude.length - DECIMAL_SCALE);
    const fractionPart = magnitude.slice(magnitude.length - DECIMAL_SCALE);
    return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
  }

  /** Same value with insignificant trailing zeros removed — display only. */
  toCompactString(): DecimalString {
    const full = this.toString();
    const trimmed = full.replace(/0+$/, "").replace(/\.$/, "");
    return trimmed === "" || trimmed === "-" ? "0" : trimmed;
  }

  /** Canonical JSON form — keeps hashes independent of the host's float rules. */
  toJSON(): DecimalString {
    return this.toString();
  }
}

/** Shorthand for `DecimalValue.fromString`. */
export const decimal = (value: string): DecimalValue => DecimalValue.fromString(value);
