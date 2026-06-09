import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { registerDevice, linkDevice, type Member } from '../../lib/api'
import { groupsOf, subgroupsOf } from './filters'
import { checkinCandidates } from './today'
import { isValidDeviceId, normalizeDeviceId } from './devices'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']

// Devices tab (parity 2.4 + 2.5): register a new device for a (possibly new) member,
// or link an extra device id to an existing member. Both go through the hardened,
// scoped, audited endpoints; the roster query is invalidated on success so the new
// device/member shows up. Hidden for pastor (read-only) at the nav level.
export function AdminDevices() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  return (
    <div className="flex flex-col gap-4">
      <RegisterCard members={data.members} />
      <LinkCard members={data.members} />
    </div>
  )
}

function RegisterCard({ members }: { members: Member[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  // Default the group to whichever 부서 the roster already uses (falls back to the first
  // canonical group) so leaders with a single scope don't have to pick every time.
  const groupOptions = useMemo(() => {
    const present = groupsOf(members)
    return present.length ? present : GROUPS
  }, [members])
  const [group, setGroup] = useState(groupOptions[0] ?? '')
  const [subgroup, setSubgroup] = useState('')
  const [busy, setBusy] = useState(false)

  const subgroupOptions = useMemo(() => subgroupsOf(members, group), [members, group])
  const canSubmit = isValidDeviceId(deviceId) && name.trim().length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      await registerDevice({
        deviceId: normalizeDeviceId(deviceId),
        name: name.trim(),
        group,
        subgroup: subgroup.trim(),
      })
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.devices.register.done'), tone: 'ok' })
      setDeviceId('')
      setName('')
      setSubgroup('')
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('admin.devices.register.title')} desc={t('admin.devices.register.desc')}>
      <Field label={t('admin.devices.deviceId')}>
        <Input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder={t('admin.devices.deviceIdPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label={t('admin.devices.register.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('admin.devices.register.group')}>
        <Select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value)
            setSubgroup('')
          }}
        >
          {groupOptions.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('admin.devices.register.subgroup')}>
        {/* A datalist gives a select-like dropdown of known 동산 while still allowing a
            brand-new name to be typed (the legacy register form is free-text). */}
        <Input
          value={subgroup}
          onChange={(e) => setSubgroup(e.target.value)}
          placeholder={t('admin.devices.register.subgroupPlaceholder')}
          list="device-subgroups"
          autoComplete="off"
        />
        <datalist id="device-subgroups">
          {subgroupOptions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Button onClick={submit} disabled={!canSubmit} className="mt-1 w-full">
        {busy ? t('common.loading') : t('admin.devices.register.submit')}
      </Button>
    </Card>
  )
}

function LinkCard({ members }: { members: Member[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [deviceId, setDeviceId] = useState('')
  const [query, setQuery] = useState('')
  const [memberId, setMemberId] = useState('')
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() => checkinCandidates(members, query), [members, query])
  const canSubmit = isValidDeviceId(deviceId) && memberId !== '' && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      await linkDevice(normalizeDeviceId(deviceId), memberId)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.devices.link.done'), tone: 'ok' })
      setDeviceId('')
      setQuery('')
      setMemberId('')
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('admin.devices.link.title')} desc={t('admin.devices.link.desc')}>
      <Field label={t('admin.devices.deviceId')}>
        <Input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder={t('admin.devices.deviceIdPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label={t('admin.devices.link.member')}>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setMemberId('')
          }}
          placeholder={t('admin.devices.link.memberSearch')}
          aria-label={t('admin.devices.link.memberSearch')}
          autoComplete="off"
        />
        {candidates.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t('admin.devices.link.memberNone')}</p>
        ) : (
          <ul className="mt-2 flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-1">
            {candidates.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setMemberId(m.id)}
                  className={
                    'w-full rounded-md border px-3 py-2 text-left transition-colors ' +
                    (memberId === m.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-surface hover:bg-surface-alt')
                  }
                >
                  <span className="text-sm font-semibold text-text">{m.name}</span>
                  <span className="ml-2 text-xs text-muted">
                    {[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Button onClick={submit} disabled={!canSubmit} className="mt-1 w-full">
        {busy ? t('common.loading') : t('admin.devices.link.submit')}
      </Button>
    </Card>
  )
}

function Card({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="font-display text-base font-semibold text-text">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted">{desc}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  )
}
