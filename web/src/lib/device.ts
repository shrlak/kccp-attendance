// Reuse the legacy localStorage key ("kccp-device-id", index.html:3814) so existing
// installs keep their identity and attendance history. New installs get a collision-free id.
const DEVICE_KEY = 'kccp-device-id'

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = 'DEV-' + crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}
