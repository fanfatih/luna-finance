import {
  forwardRef, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { parseMessage, parseNominal, rupiah } from '@/lib/money'

/* ---------- Tombol ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-hover disabled:opacity-50',
  secondary:
    'border border-line-strong bg-bg text-fg hover:bg-subtle active:bg-line disabled:opacity-50',
  ghost: 'text-fg hover:bg-subtle active:bg-line disabled:opacity-50',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80 disabled:opacity-50',
}
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...p }: ButtonProps) {
  return (
    <button
      type="button"
      {...p}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150',
        VARIANT[variant], SIZE[size], className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function IconButton({
  label, className, children, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...p}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-subtle hover:text-fg disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ---------- Kolom isian ---------- */

export function Field({
  label, hint, error, children, htmlFor, className,
}: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">{label}</label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger-text">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'h-10 w-full rounded-lg border border-line-strong bg-bg px-3 text-fg placeholder:text-muted/80 transition-colors duration-150 hover:border-muted focus-visible:border-accent-text disabled:bg-subtle disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...p },
  ref,
) {
  return <input ref={ref} {...p} className={cn(CONTROL, className)} />
})

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(CONTROL, 'h-auto min-h-20 py-2', className)} />
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cn(CONTROL, 'pr-8', className)}>
      {children}
    </select>
  )
}

/**
 * Kolom nominal bebas ketik (100rb, 100.000, 1,5jt). Menampilkan hasil bacaan di bawahnya
 * supaya salah ketik langsung terlihat sebelum disimpan.
 */
export function NominalInput({
  id, value, onChange, label, placeholder = 'Contoh: 100rb atau 150.000', allowEmpty = false, autoFocus,
}: {
  id?: string
  value: string
  onChange: (raw: string, parsed: number | null) => void
  label?: string
  placeholder?: string
  allowEmpty?: boolean
  autoFocus?: boolean
}) {
  const auto = useId()
  const fid = id ?? auto
  const zero = allowEmpty && /^0+$/.test(value.trim())
  const res = zero ? ({ ok: true, value: 0 } as const) : parseNominal(value)
  const empty = value.trim() === ''
  const showError = !empty && !res.ok
  const input = (
    <div className="flex flex-col gap-1.5">
      <Input
        id={fid}
        inputMode="text"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        aria-invalid={showError}
        aria-describedby={`${fid}-msg`}
        onChange={(e) => {
          const raw = e.target.value
          const r = allowEmpty && /^0+$/.test(raw.trim()) ? ({ ok: true, value: 0 } as const) : parseNominal(raw)
          onChange(raw, r.ok ? r.value : null)
        }}
        className={cn('num', showError && 'border-danger')}
      />
      <p id={`${fid}-msg`} className={cn('min-h-5 text-[13px]', showError ? 'text-danger-text' : 'text-muted')} role={showError ? 'alert' : undefined}>
        {showError && !res.ok ? parseMessage(res.reason) : res.ok ? `Terbaca ${rupiah(res.value)}` : allowEmpty ? 'Boleh dikosongkan.' : ''}
      </p>
    </div>
  )
  return label ? <Field label={label} htmlFor={fid}>{input}</Field> : input
}

/* ---------- Pilihan segmen ---------- */

export function Segmented<T extends string>({
  value, onChange, options, label, size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: 'sm' | 'md'
}) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-subtle p-1">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'relative inline-flex items-center justify-center rounded-md px-3 font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text',
            size === 'sm' ? 'h-7 text-[13px]' : 'h-8',
            value === o.value ? 'bg-bg text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          <input
            type="radio" name={name} value={o.value} checked={value === o.value}
            onChange={() => onChange(o.value)} className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/* ---------- Kartu & penanda ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line bg-bg', className)}>{children}</div>
}

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'
const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success-text',
  warn: 'bg-warn-soft text-warn-text',
  danger: 'bg-danger-soft text-danger-text',
}

/** Penanda status sungguhan (aktif, hampir habis, lunas). Bukan hiasan. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone])}>
      {children}
    </span>
  )
}

export function Money({ value, signed, className }: { value: number; signed?: boolean; className?: string }) {
  const tone = value > 0 ? 'text-success-text' : value < 0 ? 'text-danger-text' : 'text-fg'
  return (
    <span className={cn('num', signed && tone, className)}>
      {signed && value > 0 ? '+' : ''}
      {rupiah(value)}
    </span>
  )
}

/* ---------- Keadaan kosong, memuat, galat ---------- */

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-8">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-muted">{body}</p>
      </div>
      {action}
    </div>
  )
}

export function Loading({ label = 'Memuat data' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft p-6">
      <div>
        <p className="font-semibold text-danger-text">Gagal memuat data</p>
        <p className="mt-1 text-fg">{message}</p>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Coba lagi</Button>}
    </div>
  )
}

/* ---------- Dialog ---------- */

/** Dialog yang sedang terbuka, yang paling atas menutup duluan saat Escape ditekan. */
const openStack: symbol[] = []

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open, onClose, title, children, footer, width = 'max-w-lg',
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const lastFocus = useRef<HTMLElement | null>(null)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape berlaku di mana pun fokusnya, hanya untuk dialog paling atas.
  useEffect(() => {
    if (!open) return
    const id = Symbol('dialog')
    openStack.push(id)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('keydown', onEsc)
      const i = openStack.indexOf(id)
      if (i >= 0) openStack.splice(i, 1)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus],input,select,textarea') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE)
      el?.focus()
    }, 30)
    return () => {
      clearTimeout(t)
      lastFocus.current?.focus?.()
    }
  }, [open])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return
    const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!els.length) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          onKeyDown={onKey}
        >
          <motion.div
            ref={ref}
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={cn('flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-bg shadow-xl', width)}
            initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.12 }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
              <h2 id={titleId} className="text-base font-semibold">{title}</h2>
              <IconButton label="Tutup" onClick={onClose} className="-mr-2 size-9"><X className="size-4" aria-hidden="true" /></IconButton>
            </div>
            <div data-selectable className="overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmLabel, danger,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>
  title: string; body: string; confirmLabel: string; danger?: boolean
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open} onClose={onClose} title={title} width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button
            variant={danger ? 'danger' : 'primary'} loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Dialog>
  )
}

/* ---------- Toast ---------- */

interface ToastItem { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id} layout
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
              className={cn(
                'pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-lg',
                t.tone === 'error' ? 'border-danger/40 bg-danger-soft text-danger-text' : 'border-line bg-bg text-fg',
              )}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- Tata letak halaman ---------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table aria-label={label} className="w-full border-collapse text-left [&_tbody_tr:last-child>td]:border-b-0">{children}</table>
    </div>
  )
}

export const TH = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <th scope="col" className={cn('border-b border-line bg-surface px-4 py-2.5 text-[13px] font-medium whitespace-nowrap text-muted', right && 'text-right', className)}>
    {children}
  </th>
)

export const TD = ({ children, right, className, colSpan }: { children?: ReactNode; right?: boolean; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cn('border-b border-line px-4 py-3 align-middle', right && 'text-right', className)}>
    {children}
  </td>
)
