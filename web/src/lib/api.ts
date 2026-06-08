import { getDeviceId } from './device'

const API_BASE = import.meta.env.VITE_API_BASE as string
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const resp = await fetch(API_BASE + path, {
      method,
      headers,
      signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined,
    })
    clearTimeout(timer)
    try {
      return (await resp.json()) as T
    } catch {
      return { error: `HTTP ${resp.status} — non-JSON response` } as T
    }
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

// Phase-0 response shapes (from the attendance-api edge function)
export interface AppConfig {
  announcement: string
  checkinDays: number[]
  checkinStartMin: number
  checkinEndMin: number
  requireApproval: boolean
  summerMode: boolean
  demoMode: boolean
  individualCheckinEnabled: boolean
}

export const getConfig = () => api<AppConfig>('GET', '/api/config')
