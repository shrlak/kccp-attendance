import { useEffect, useState } from 'react'
import { useLang } from '../../stores/useLang'
import { easternNow, formatClock } from '../../lib/checkinWindow'

const DAY_FULL: Record<'ko' | 'en', string[]> = {
  ko: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

// A live Eastern-time clock for the restriction states — reassures the visitor
// that the gate is about the schedule, not a malfunction.
export function LiveClock() {
  const lang = useLang((s) => s.lang)
  const [now, setNow] = useState(() => easternNow())
  useEffect(() => {
    const id = setInterval(() => setNow(easternNow()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex flex-col items-center gap-1.5 font-mono">
      <div className="text-sm tracking-wide text-muted">
        {now.date} <span className="text-primary">{DAY_FULL[lang][now.weekday]}</span>
      </div>
      <div className="text-2xl font-bold tracking-widest tabular-nums text-text">{formatClock(now)}</div>
    </div>
  )
}
