const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;

  for (const character of value) {
    const index = BASE64_URL_ALPHABET.indexOf(character);
    if (index < 0) return null;
    buffer = (buffer << 6) | index;
    bitCount += 6;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >>> bitCount) & 0xff);
    }
  }

  return bitCount > 0 && (buffer & ((1 << bitCount) - 1)) !== 0
    ? null
    : Uint8Array.from(bytes);
}
