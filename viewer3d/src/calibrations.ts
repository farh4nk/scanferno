import type { Calibration } from './frame'

/**
 * Hand-checked calibrations per building id. When set, these win over the automatic fit. Get the values
 * from the dev page (Calibration panel -> "Copy JSON") after nudging the overlay into place.
 */
export const SAVED_CALIBRATIONS: Record<string, Calibration> = {}
