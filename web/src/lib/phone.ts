// Formats US 10-digit numbers as (123) 456-7890, live as the digits are typed, and
// Korean 11-digit 010 mobiles as 010-1234-5678. Anything else (partial input, foreign
// numbers, freeform notes) passes through unchanged rather than getting mangled.
export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw
  if (digits.length === 11 && digits.startsWith('010')) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  if (digits.length > 10) return raw
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
