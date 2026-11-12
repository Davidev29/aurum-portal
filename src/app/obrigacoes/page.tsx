'use client'

import {
  CalendarDays,
  ClipboardCheck,
  ListChecks,
  Building2,
  FolderOpen,
  CalendarClock,
} from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MatrixGrid } from '@/components/obligations/matrix-grid'
import { ObligationsTab } from '@/components/obligations/obligations-tab'
import { DepartmentsTab } from '@/components/obligations/departments-tab'
import { GroupsTab } from '@/components/obligations/groups-tab'
import { ObligationsMonthView } from '@/components/obligations/obligations-month-view'

export default function ObrigacoesPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Rotinas recorrentes"
        title="Obrigações"
        description="Calendário do mês com as obrigações de cada cliente e baixa de entregas por dia; catálogo de obrigações, matriz de vínculos, grupos, departamentos e avisos de vencimento na central de avisos."
        icon={<ClipboardCheck className="h-6 w-6" aria-hidden="true" />}
      />

      <Tabs defaultValue="obrigacoes">
        <TabsList aria-label="Seções de obrigações" className="mx-auto flex w-fit">
          <TabsTrigger value="obrigacoes">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Obrigações
          </TabsTrigger>
          <TabsTrigger value="matriz">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Matriz de vínculos
          </TabsTrigger>
          <TabsTrigger value="catalogo">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Catálogo
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

        <TabsContent value="obrigacoes">
          <ObligationsMonthView />
        </TabsContent>
        <TabsContent value="matriz">
          <MatrixGrid />
        </TabsContent>
        <TabsContent value="catalogo">
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
