/**
 * Deterministic trig. `Math.sin`/`Math.cos` are implementation-defined in ECMAScript (V8, JSC and
 * SpiderMonkey may differ in the last bit), which would break cross-engine replay determinism before the
 * input even reaches Rapier. These use only +, −, ×, / (exactly rounded IEEE-754 in every engine), so a
 * replay recorded in Safari replays bit-identically in Node/workerd.
 *
 * Accuracy: |error| < 2e-16 on [−π/4, π/4] (Taylor to x^17 / x^16), a few ulp after range reduction
 * for the |x| ≤ 100 rad the sim ever sees. Far more than physics needs.
 */

const HALF_PI_HI = 1.5707963267341256; // Cody–Waite split of π/2
const HALF_PI_LO = 6.077100506506192e-11;
const INV_HALF_PI = 0.6366197723675814;

function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

function cosPoly(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 +
                    x2 *
                      (-1 / 3628800 +
                        x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 / 20922789888000)))))))
  );
}

/** Quadrant-reduced (sin, cos). */
function reduce(x: number): [number, number] {
  const q = Math.round(x * INV_HALF_PI); // Math.round is exact
  const r = x - q * HALF_PI_HI - q * HALF_PI_LO;
  const s = sinPoly(r);
  const c = cosPoly(r);
  switch (((q % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

export function dsin(x: number): number {
  return reduce(x)[0];
}

export function dcos(x: number): number {
  return reduce(x)[1];
}

/** 1 − exp(−x) for the per-tick smoothing factor, via a deterministic series (x is small: dt/τ ≤ 0.1). */
export function oneMinusExpNeg(x: number): number {
  // exp(−x) by Taylor to 12 terms (x ≤ 1 → error < 1e-10, enough for a smoothing factor).
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 16; i++) {
    term *= -x / i;
    sum += term;
  }
  return 1 - sum;
}
