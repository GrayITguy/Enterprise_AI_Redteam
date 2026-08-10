// src/server/config/transforms.ts
// Pure, dependency-free text transforms inspired by elder-plinius/P4RS3LT0NGV3.
// Used as composable layers on adversarial prompts for better filter evasion testing.
// All functions are deterministic. Focus on common smuggling / mutation vectors.

export interface TransformDef {
  name: string;
  description: string;
  apply: (text: string) => string;
}

export const TRANSFORMS: Record<string, TransformDef> = {
  base64: {
    name: 'Base64',
    description: 'Base64 encoding (common smuggling vector)',
    apply: (text: string) => Buffer.from(text, 'utf8').toString('base64'),
  },
  rot13: {
    name: 'ROT13',
    description: 'ROT13 letter substitution cipher',
    apply: (text: string) =>
      text.replace(/[a-zA-Z]/g, (char) => {
        const code = char.charCodeAt(0);
        const base = code <= 90 ? 65 : 97;
        return String.fromCharCode(((code - base + 13) % 26) + base);
      }),
  },
  leetspeak: {
    name: 'Leetspeak',
    description: 'Simple leetspeak substitution (a=4, e=3, i=1, o=0, s=5, t=7)',
    apply: (text: string) =>
      text
        .replace(/a/gi, '4')
        .replace(/e/gi, '3')
        .replace(/i/gi, '1')
        .replace(/o/gi, '0')
        .replace(/s/gi, '5')
        .replace(/t/gi, '7'),
  },
  zeroWidth: {
    name: 'Zero-Width Stego',
    description: 'Insert zero-width spaces (U+200B) for invisible payload smuggling',
    apply: (text: string) => {
      return text.split('').map((c, i) => (i % 2 === 1 ? '\u200B' + c : c)).join('');
    },
  },
  homoglyph: {
    name: 'Homoglyph (Cyrillic)',
    description: 'Replace some Latin letters with visually similar Cyrillic (e.g. a->а)',
    apply: (text: string) => {
      const map: Record<string, string> = {
        a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у',
        A: 'А', E: 'Е', O: 'О', P: 'Р', C: 'С', X: 'Х', Y: 'У',
      };
      return text.replace(/[aeop cxyAEOP CXY]/g, (ch) => map[ch] || ch);
    },
  },
  caesar3: {
    name: 'Caesar Shift +3',
    description: 'Simple Caesar cipher shift by 3 (letters only)',
    apply: (text: string) =>
      text.replace(/[a-zA-Z]/g, (char) => {
        const code = char.charCodeAt(0);
        const base = code <= 90 ? 65 : 97;
        return String.fromCharCode(((code - base + 3) % 26) + base);
      }),
  },
  urlEncode: {
    name: 'URL Encode',
    description: 'Percent-encoding for smuggling (common in web attacks)',
    apply: (text: string) => encodeURIComponent(text),
  },
  whitespaceStego: {
    name: 'Whitespace Stego',
    description: 'Insert extra spaces and tabs (invisible in many renderers)',
    apply: (text: string) => text.split(' ').join('  \t '),
  },
  fullWidth: {
    name: 'Full-Width Unicode',
    description: 'Convert ASCII to full-width equivalents (bypass some filters)',
    apply: (text: string) => text.replace(/[ -~]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 33 && code <= 126) return String.fromCharCode(code + 0xFEE0);
      return ch;
    }),
  },
  identity: {
    name: 'Identity (no-op)',
    description: 'No transformation (for testing/composer)',
    apply: (text: string) => text,
  },
} as const;

export type TransformKey = keyof typeof TRANSFORMS;

export function applyTransform(text: string, key: TransformKey): string {
  const def = TRANSFORMS[key];
  if (!def) {
    throw new Error(`Unknown transform key: ${key}. Available: ${Object.keys(TRANSFORMS).join(', ')}`);
  }
  return def.apply(text);
}

export function listTransforms() {
  return Object.entries(TRANSFORMS).map(([key, def]) => ({
    key: key as TransformKey,
    name: def.name,
    description: def.description,
  }));
}

// Helper: apply a chain of transforms in order (for composer)
export function applyTransformsChain(text: string, keys: TransformKey[]): string {
  return keys.reduce((current, key) => applyTransform(current, key), text);
}
