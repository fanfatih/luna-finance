import { ClipboardPen, HandCoins, LayoutDashboard, FileSpreadsheet } from 'lucide-react'
import { useApp, type KeuanganTab } from '@/app/context'
import { SidebarLayout } from '@/components/Shell'
import { Catat } from './Catat'
import { Dashboard } from './Dashboard'
import { Laporan } from './Laporan'
import { Utang } from './Utang'

const ITEMS: { id: KeuanganTab; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'catat', label: 'Catat Keuangan Harian', icon: <ClipboardPen className="size-4" /> },
  { id: 'utang', label: 'Data Utang-Piutang', icon: <HandCoins className="size-4" /> },
  { id: 'laporan', label: 'Laporan', icon: <FileSpreadsheet className="size-4" /> },
]

export function Keuangan({ tab, date }: { tab: KeuanganTab; date?: string }) {
  const { go } = useApp()
  return (
    <SidebarLayout items={ITEMS} active={tab} onSelect={(id) => go({ name: 'keuangan', tab: id as KeuanganTab })}>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'catat' && <Catat initialDate={date} />}
      {tab === 'utang' && <Utang />}
      {tab === 'laporan' && <Laporan />}
    </SidebarLayout>
  )
}
