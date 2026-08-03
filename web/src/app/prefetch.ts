// Route chunks are lazy (see routes.tsx), which costs one round trip the first time
// someone opens the panel or the kiosk. Start that fetch on intent instead — a pointer
// settling on the link, or the first touch before the tap completes — so the chunk is
// usually parsed by the time the navigation happens. Dynamic imports are idempotent, so
// firing these repeatedly is free; the specifiers must stay identical to routes.tsx's or
// the prefetch would warm a second copy of the chunk.

export function prefetchAdmin(): void {
  void import('../features/admin/AdminShell')
}

export function prefetchKiosk(): void {
  void import('../features/kiosk/KioskShell')
}
