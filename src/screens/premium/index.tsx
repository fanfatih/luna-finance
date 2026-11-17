import { Contact, ListChecks, MessageSquareText, Tags } from 'lucide-react'
import { useApp, type PremiumTab } from '@/app/context'
import { SidebarLayout } from '@/components/Shell'
import { Customers } from './Customers'
import { Pricelist } from './Pricelist'
import { Rekap } from './Rekap'
import { Template } from './Template'

const ITEMS: { id: PremiumTab; label: string; icon: React.ReactNode }[] = [
  { id: 'rekap', label: 'Rekap Data Apk Premium', icon: <ListChecks className="size-4" /> },
  { id: 'customer', label: 'Data Customer', icon: <Contact className="size-4" /> },
  { id: 'pricelist', label: 'Pricelist', icon: <Tags className="size-4" /> },
  { id: 'template', label: 'Template WhatsApp', icon: <MessageSquareText className="size-4" /> },
]

export function Premium({ tab }: { tab: PremiumTab }) {
  const { go } = useApp()
  return (
    <SidebarLayout items={ITEMS} active={tab} onSelect={(id) => go({ name: 'premium', tab: id as PremiumTab })}>
      {tab === 'rekap' && <Rekap />}
      {tab === 'customer' && <Customers />}
      {tab === 'pricelist' && <Pricelist />}
      {tab === 'template' && <Template />}
    </SidebarLayout>
  )
}
