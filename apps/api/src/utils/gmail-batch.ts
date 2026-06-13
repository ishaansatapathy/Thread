/** Fetch Gmail thread metadata in parallel waves (one HTTP call per thread, grouped for locality). */
export async function fetchInWaves<T, R>(
  items: T[],
  waveSize: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  for (let offset = 0; offset < items.length; offset += waveSize) {
    const slice = items.slice(offset, offset + waveSize);
    const wave = await Promise.all(
      slice.map((item, index) => worker(item, offset + index)),
    );
    for (let i = 0; i < wave.length; i++) {
      results[offset + i] = wave[i]!;
    }
  }
  return results;
}
