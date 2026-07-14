// Geofence check — ported verbatim from supabase/functions/attendance-api/index.ts.
const CHURCH_LAT = 40.450218535488325;
const CHURCH_LNG = -79.93480148825721;

// Returns "required" if no coords given, null if within range, or the distance in
// meters (rounded) if outside the 30m allowance.
export function checkLocation(lat?: number | null, lng?: number | null): "required" | number | null {
  if (lat == null || lng == null) return "required";
  const R = 6371000;
  const dLat = ((lat - CHURCH_LAT) * Math.PI) / 180;
  const dLng = ((lng - CHURCH_LNG) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((CHURCH_LAT * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return dist > 30 ? Math.round(dist) : null;
}
