/**
 * Mask an on-chain address as `prefix...suffix`, returning it unchanged when it
 * is too short to mask without the truncated segments overlapping.
 */
export function maskAddress(address: string): string {
  const head = 8;
  const tail = 6;
  if (address.length <= head + tail) {
    return address;
  }
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
