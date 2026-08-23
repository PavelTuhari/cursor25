/**
 * Barcode encoders for the loyalty card.
 *
 * The card is rendered from these bar patterns with plain views, so the app
 * needs no native barcode library and works offline. EAN-13 and Code 128 (set
 * B) cover what Moldovan retail checkouts scan.
 */

export interface BarcodePattern {
  /** Widths in modules, alternating bar/space, starting with a bar. */
  bars: number[];
  text: string;
  format: 'ean13' | 'code128';
}

/* ------------------------------------------------------------------ EAN-13 */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(digits: string): number {
  const body = digits.slice(0, 12);
  if (!/^\d{12}$/.test(body)) throw new Error('EAN-13 needs 12 digits to compute the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value) === Number(value[12]);
}

/** Pads/normalises a card number into a 13-digit EAN-13 payload. */
export function normalizeEan13(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13) return digits;
  if (digits.length === 12) return digits + String(ean13CheckDigit(digits));
  const padded = digits.slice(0, 12).padStart(12, '0');
  return padded + String(ean13CheckDigit(padded));
}

function binaryToBars(binary: string): number[] {
  const bars: number[] = [];
  let current = '1';
  let run = 0;
  for (const bit of binary) {
    if (bit === current) {
      run += 1;
      continue;
    }
    bars.push(run);
    current = bit;
    run = 1;
  }
  bars.push(run);
  return bars;
}

export function encodeEan13(value: string): BarcodePattern {
  const digits = normalizeEan13(value);
  const parity = EAN_PARITY[Number(digits[0])] as string;
  let binary = '101';
  for (let i = 1; i <= 6; i += 1) {
    const digit = Number(digits[i]);
    binary += parity[i - 1] === 'L' ? (EAN_L[digit] as string) : (EAN_G[digit] as string);
  }
  binary += '01010';
  for (let i = 7; i <= 12; i += 1) {
    binary += EAN_R[Number(digits[i])] as string;
  }
  binary += '101';
  return { bars: binaryToBars(binary), text: digits, format: 'ean13' };
}

/* ---------------------------------------------------------------- Code 128 */

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

/** Code 128 set B covers ASCII 32–126, which is all a card number needs. */
export function encodeCode128(value: string): BarcodePattern {
  if (!/^[\x20-\x7E]+$/.test(value)) {
    throw new Error('Code 128 set B supports printable ASCII only');
  }
  const codes = [CODE128_START_B];
  for (const char of value) {
    codes.push(char.charCodeAt(0) - 32);
  }
  let checksum = CODE128_START_B;
  for (let i = 1; i < codes.length; i += 1) {
    checksum += (codes[i] as number) * i;
  }
  codes.push(checksum % 103, CODE128_STOP);

  const bars: number[] = [];
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) throw new Error(`no Code 128 pattern for value ${code}`);
    for (const width of pattern) bars.push(Number(width));
  }
  return { bars, text: value, format: 'code128' };
}

export function encodeBarcode(value: string, format: 'ean13' | 'code128'): BarcodePattern {
  return format === 'ean13' ? encodeEan13(value) : encodeCode128(value);
}
