// Pure helpers for the Devices tab (register / link a device id).

// A device id is the fingerprint string the kiosk/check-in client stores in
// localStorage (e.g. "DEV-XXXXXXXX-XXXXXXXX", or a seeded "ROSTER-12"). For the admin
// forms we only need a non-empty, whitespace-trimmed token — the server is the source of
// truth for shape. Trim here so a pasted value with stray spaces still validates.
export function normalizeDeviceId(raw: string): string {
  return raw.trim()
}

// True when the (trimmed) device id is usable to submit. Keeps the bar low on purpose:
// the legacy app accepts any pasted token, and ROSTER-/DEV-/MANUAL- ids are all valid.
export function isValidDeviceId(raw: string): boolean {
  return normalizeDeviceId(raw).length > 0
}
