/**
 * Reading cleanup for an ultrasonic sensor.
 *
 * An HC-SR04 reports roughly 2 cm to 4 m. Outside that it has heard no echo,
 * which means nobody is in front of it, not that someone is 0 m away. Inside
 * that range single readings spike when an echo bounces off a bag or a
 * sleeve. A median of the last few readings discards the spikes without the
 * lag an average would add.
 */

export const SENSOR_MIN_M = 0.02;
export const SENSOR_MAX_M = 4.0;
/** What "no echo" is reported as: comfortably beyond the ambient boundary. */
export const NOBODY_M = 5.0;

export function sanitise(metres: number): number {
  if (!Number.isFinite(metres) || metres < SENSOR_MIN_M || metres > SENSOR_MAX_M)
    return NOBODY_M;
  return metres;
}

export function createMedian(window = 5): (metres: number) => number {
  const recent: number[] = [];
  return (metres: number) => {
    recent.push(sanitise(metres));
    if (recent.length > window) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  };
}
