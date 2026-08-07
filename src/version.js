// Version constants. Deliberately separate, because they answer different
// questions and move at different rates.

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

/**
 * Layout and meaning of the on-disk data directory (src/storage). Bump when the
 * directory's file layout or meta.json shape changes. A v1 store opened by a
 * client that finds a HIGHER version on disk must refuse rather than guess —
 * user data written by a newer version is not this version's to reinterpret.
 */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * Shape of one retained measurement record (src/storage/measurements.js). Bump
 * on ANY field addition, removal, or meaning change — the record allowlist is
 * closed, so even an additive field is a new shape. Records carry their version;
 * a reader reports records from a newer version as uninterpreted rather than
 * dropping them silently or guessing at their fields.
 */
export const MEASUREMENT_SCHEMA_VERSION = 1;
