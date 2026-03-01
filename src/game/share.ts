/**
 * Share code generation and normalization helpers.
 * Uses Crockford Base32 to avoid confusing characters.
 */

// Crockford Base32 alphabet (no I, L, O, U to avoid confusion)
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a random 8-char Crockford Base32 share code */
export function generateShareCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    const byteIdx = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    let value: number;
    if (bitOffset <= 3) {
      value = (bytes[byteIdx] >> (3 - bitOffset)) & 0x1f;
    } else {
      const bitsFromFirst = 8 - bitOffset;
      const bitsFromSecond = 5 - bitsFromFirst;
      value =
        ((bytes[byteIdx] & ((1 << bitsFromFirst) - 1)) << bitsFromSecond) |
        ((bytes[byteIdx + 1] ?? 0) >> (8 - bitsFromSecond));
    }
    code += CROCKFORD[value & 0x1f];
  }
  return code;
}

/**
 * Normalize a user-entered share code:
 * - Uppercase
 * - Strip dashes, spaces, and other separators
 * - Replace commonly confused chars (I→1, L→1, O→0, U→V)
 */
export function normalizeShareCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .slice(0, 8);
}

/** Format code for display: "ABCD-EFGH" */
export function formatShareCode(code: string): string {
  const clean = normalizeShareCode(code);
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}
