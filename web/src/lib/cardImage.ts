// Prepares a 새가족카드 photo for the scan endpoint: phone-camera photos are 5–20MB,
// far over the edge function's payload limit and wasteful as vision input. Downscale to
// max 1568px on the long edge (the model's effective resolution cap) and re-encode as
// JPEG, returning the bare base64 payload (no data: prefix).
const MAX_EDGE = 1568
const JPEG_QUALITY = 0.85

export async function prepareCardImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    // White backing so transparent PNGs don't turn black when flattened to JPEG.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image file'))
    img.src = url
  })
}
