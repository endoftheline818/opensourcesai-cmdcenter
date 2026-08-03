// Version constants. Three of them, deliberately separate, because they answer
// different questions and move at different rates.

/** The package version. Must equal package.json's version (asserted in tests). */
export const CLIENT_VERSION = "0.1.0";

/**
 * Shape of a raw capture (what src/collect produces). Bump when the RAW probe
 * output changes shape, which invalidates committed fixtures.
 */
export const CAPTURE_SCHEMA_VERSION = 1;

/**
 * Shape and meaning of a diagnostic report (what src/derive produces).
 *
 * Mirrors the website's CHECKER_RESULT_CONTRACT_VERSION discipline: bump when
 * the shape or the MEANING of a report changes, not when the machine it
 * describes changes. A report carrying version N can then be checked against
 * the rules that produced it.
 */
export const REPORT_CONTRACT_VERSION = 1;
