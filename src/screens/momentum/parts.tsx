import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge, IconButton } from '@/components/ui'
import { PAY_LABEL, payState, remaining, stageLabel, type PayState } from '@/lib/momentum'
import { monthLabel } from '@/lib/date'
import { shiftYm } from '@/lib/expense'

const STAGE_TONE: Record<string, 'neutral' | 'accent' | 'warn' | 'success'> = {
  inquiry: 'neutral', booking: 'accent', produksi: 'warn', selesai: 'success', batal: 'neutral',
}

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={STAGE_TONE[stage] ?? 'neutral'}>{stageLabel(stage)}</Badge>
}

const PAY_TONE: Record<PayState, 'neutral' | 'accent' | 'success' | 'warn'> = {
  belum: 'neutral', dp: 'accent', lunas: 'success', lebih: 'warn',
}

/** Status bayar klien. Project yang belum punya item (nilai nol) tidak diberi status. */
export function PayBadge({ total, paid }: { total: number; paid: number }) {
  if (total === 0 && paid === 0) return <span className="text-muted">-</span>
  const s = payState(total, paid)
  return <Badge tone={PAY_TONE[s]}>{PAY_LABEL[s]}</Badge>
}

export { remaining }

/** Pilih bulan dengan panah. */
export function MonthNav({ month, onChange }: { month: string; onChange: (ym: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Bulan sebelumnya" onClick={() => onChange(shiftYm(month, -1))} className="border border-line-strong">
        <ChevronLeft className="size-4" aria-hidden="true" />
      </IconButton>
      <span className="min-w-40 text-center font-semibold">{monthLabel(month)}</span>
      <IconButton label="Bulan berikutnya" onClick={() => onChange(shiftYm(month, 1))} className="border border-line-strong">
        <ChevronRight className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

/** Hari menuju tanggal, untuk daftar acara mendatang. */
export function daysText(days: number): string {
  if (days === 0) return 'Hari ini'
  if (days === 1) return 'Besok'
  if (days < 0) return `${-days} hari lalu`
  return `${days} hari lagi`
}
