/**
 * A model id as a name a person can read: muse-spark-1.3 becomes "Muse Spark 1.3". An id that is not that shape is
 * left exactly as it is, so an unknown model still reads as what it is rather than as something guessed.
 */
export function modelLabel(id: string): string {
  const trimmed = id.trim();
  const match = /^([a-z]+(?:-[a-z]+)*)-(\d+(?:\.\d+)*)$/.exec(trimmed);
  if (!match) return trimmed;
  const words = match[1].split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return `${words.join(" ")} ${match[2]}`;
}
