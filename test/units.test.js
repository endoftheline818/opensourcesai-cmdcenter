import test from "node:test";
import assert from "node:assert/strict";
import { GIB, MIB, mibToBytes, nameplateGb, toGb, toGib } from "../src/units.js";

// REGRESSION TEST FOR THE BAND-BOUNDARY BUG.
//
// These are not synthetic numbers. 12282 MiB is what an RTX 4070 Ti actually
// reports and 10240 MiB is what an RTX 3080 actually reports, both measured
// during Phase 0 validation. The pair matters: the 4070 Ti reproduces the
// defect and the 3080 does not, which is what established that the bug is
// boundary-specific rather than general — and therefore that testing on one
// mid-band card would have shipped it.
test("nameplateGb recovers the figure an owner would recognise", () => {
  const rtx4070ti = mibToBytes(12282);
  assert.equal(toGib(rtx4070ti), 11.99, "raw GiB is below nameplate — vendors reserve framebuffer");
  assert.equal(nameplateGb(rtx4070ti), 12, "nameplate rounds back to what the box says");

  const rtx3080 = mibToBytes(10240);
  assert.equal(toGib(rtx3080), 10, "a mid-band card needs no correction");
  assert.equal(nameplateGb(rtx3080), 10);
});

test("the boundary defect only bites nameplate-on-edge cards", async () => {
  const { memoryBand } = await import("../src/derive/bands.js");

  // 4070 Ti: raw GiB and nameplate land in DIFFERENT tiers. This is the bug.
  const rtx4070ti = mibToBytes(12282);
  assert.equal(memoryBand(toGib(rtx4070ti)), "8-11", "raw GiB understates the card by a full tier");
  assert.equal(memoryBand(nameplateGb(rtx4070ti)), "12-15", "nameplate is correct");

  // 3080: every treatment agrees, because 10 GB sits mid-tier rather than on an edge.
  const rtx3080 = mibToBytes(10240);
  assert.equal(memoryBand(toGib(rtx3080)), "8-11");
  assert.equal(memoryBand(nameplateGb(rtx3080)), "8-11");
});

test("every nameplate-on-edge capacity survives the round trip", async () => {
  const { memoryBand } = await import("../src/derive/bands.js");
  // The tier edges are 8/12/16/24/32/48. A card whose nameplate IS an edge is
  // exactly the at-risk population; assume each reports slightly under, as all
  // real hardware does.
  for (const nameplate of [8, 12, 16, 24, 32, 48]) {
    const reported = mibToBytes(nameplate * 1024 - 6); // 6 MiB reserved, as observed
    assert.equal(
      nameplateGb(reported),
      nameplate,
      `${nameplate} GB card must not be rounded down`,
    );
    assert.equal(
      memoryBand(nameplateGb(reported)),
      memoryBand(nameplate),
      `${nameplate} GB card must land in the same tier as its nameplate`,
    );
  }
});

test("unit conversions are unit-correct and never silently coerce", () => {
  assert.equal(MIB, 1048576);
  assert.equal(GIB, 1073741824);
  // 12 GiB is 12.88 decimal GB — the two are NOT interchangeable, which is the
  // confusion that produced a phantom 3x disagreement in the original spike.
  assert.equal(toGib(12 * GIB), 12);
  assert.equal(toGb(12 * GIB), 12.88);

  for (const bad of [null, undefined, NaN, "twelve"]) {
    assert.equal(nameplateGb(bad), null);
    assert.equal(toGib(bad), null);
  }
  assert.equal(nameplateGb(0), null);
  assert.equal(nameplateGb(-1), null);
});
