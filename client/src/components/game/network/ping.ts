export function getSmoothedPingDisplay(
    currentSamples: number[],
    sampleMs: number,
): { samples: number[]; text: string; value: number } {
    const samples = [...currentSamples, sampleMs].slice(-6);
    const sortedSamples = [...samples].sort((a, b) => a - b);
    const middleIndex = Math.floor(sortedSamples.length / 2);
    const stablePingMs =
        sortedSamples.length % 2 === 0
            ? Math.round(
                  (sortedSamples[middleIndex - 1] +
                      sortedSamples[middleIndex]) /
                      2,
              )
            : sortedSamples[middleIndex];

    return {
        samples,
        text: `Ping: ${stablePingMs} ms`,
        value: stablePingMs,
    };
}
