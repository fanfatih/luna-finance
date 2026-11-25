import { FileSpreadsheet, FolderKanban, LayoutDashboard, Receipt, ReceiptText } from 'lucide-react'
import { useApp, type MomentumTab } from '@/app/context'
import { SidebarLayout } from '@/components/Shell'
import { Dashboard } from './Dashboard'
import { Invoices } from './Invoices'
import { Keuangan } from './Keuangan'
import { Laporan } from './Laporan'
import { Projects } from './Projects'

const ITEMS: { id: MomentumTab; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'project', label: 'Project', icon: <FolderKanban className="size-4" /> },
  { id: 'keuangan', label: 'Keuangan', icon: <Receipt className="size-4" /> },
  { id: 'invoice', label: 'Invoice klien', icon: <ReceiptText className="size-4" /> },
  { id: 'laporan', label: 'Laporan', icon: <FileSpreadsheet className="size-4" /> },
]

export function Momentum({ tab, projectId }: { tab: MomentumTab; projectId?: string }) {
  const { go } = useApp()
  return (
    <SidebarLayout items={ITEMS} active={tab} onSelect={(id) => go({ name: 'momentum', tab: id as MomentumTab })}>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'project' && <Projects openId={projectId} />}
      {tab === 'keuangan' && <Keuangan />}
      {tab === 'invoice' && <Invoices />}
      {tab === 'laporan' && <Laporan />}
    </SidebarLayout>
  )
}
