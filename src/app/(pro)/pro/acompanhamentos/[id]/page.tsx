import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";

import { PageHeader } from "@/components/journey/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import {
  getProfessionalPatient,
  ProfessionalAccessError,
} from "@/server/services/professional-service";
import { PatientView } from "./view";

export const metadata: Metadata = { title: "Dossiê do acompanhamento" };

export default async function ProAcompanhamentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireVerifiedProfessional();
  let patient;
  try {
    patient = await getProfessionalPatient(supabase, user, id);
  } catch (error) {
    if (error instanceof ZodError) notFound();
    if (error instanceof ProfessionalAccessError) {
      /*
        Uma unica mensagem para "nao existe", "de outro profissional", "pausado",
        "encerrado" e "verificacao vencida": diferenciar aqui revelaria a quem
        testa UUIDs se aquela pessoa tem vinculo com alguem.
      */
      return (
        <>
          <PageHeader title="Dossiê indisponível" />
          <Card>
            <CardContent>
              <EmptyState
                title="Este dossiê não está disponível para você agora"
                description="O acesso exige vínculo ativo e verificação vigente. Se a pessoa pausou ou encerrou o vínculo, o dossiê fica fechado."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/pro/acompanhamentos">Voltar para acompanhamentos</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </>
      );
    }
    throw error;
  }
  return <PatientView patient={patient} />;
}
