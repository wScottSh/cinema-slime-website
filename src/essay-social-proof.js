export function aggregateSocialProof(coordinateString, events) {
  let totalSats = 0;
  let largestZap = 0;
  let heartCount = 0;

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    if (event.kind === 9735) {
      const aTag = event.tags?.find(t => t[0] === 'a')?.[1];
      if (aTag !== coordinateString) continue;
      const amountTag = event.tags?.find(t => t[0] === 'amount')?.[1];
      const msats = Number(amountTag);
      if (!Number.isFinite(msats) || msats <= 0) continue;
      const sats = Math.floor(msats / 1000);
      totalSats += sats;
      if (sats > largestZap) largestZap = sats;
    } else if (event.kind === 7) {
      const aTag = event.tags?.find(t => t[0] === 'a')?.[1];
      if (aTag !== coordinateString) continue;
      heartCount++;
    }
  }

  return { totalSats, largestZap, heartCount };
}
