'use client'

import { CalendarClock, ClipboardCheck, ListChecks, Building2, FolderOpen } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MatrixGrid } from '@/components/obligations/matrix-grid'
import { ObligationsTab } from '@/components/obligations/obligations-tab'
import { DepartmentsTab } from '@/components/obligations/departments-tab'
import { GroupsTab } from '@/components/obligations/groups-tab'

export default function ObrigacoesPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Rotinas recorrentes"
        title="Obrigações"
        description="Catálogo de obrigações recorrentes (SPED, DCTF, FGTS, eSocial…), matriz de vínculos por cliente, grupos reutilizáveis e avisos de vencimento na central de avisos."
        icon={<ClipboardCheck className="h-6 w-6" aria-hidden="true" />}
      />

      <Tabs defaultValue="matriz">
        <TabsList aria-label="Seções de obrigações">
          <TabsTrigger value="matriz">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Matriz de vínculos
          </TabsTrigger>
          <TabsTrigger value="obrigacoes">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Obrigações
          </TabsTrigger>
          <TabsTrigger value="departamentos">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Departamentos
          </TabsTrigger>
          <TabsTrigger value="grupos">
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Grupos de obrigações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="matriz">
          <MatrixGrid />
        </TabsContent>
        <TabsContent value="obrigacoes">
          <ObligationsTab />
        </TabsContent>
        <TabsContent value="departamentos">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="grupos">
          <GroupsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  )
}
