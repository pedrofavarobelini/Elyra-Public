

import { createClient } from "@supabase/supabase-js";

import { auditarRotuloDeCatalogo } from "../src/lib/contracts/vocabulary.ts";

/** Catalogos com rotulo de apresentacao vindo do produto. */
const CATALOGOS = [
  { tabela: "emotional_factors", onde: "chips de fator em /meu-humor" },
  { tabela: "journal_tags", onde: "tags em /diario" },
  { tabela: "cycle_symptoms", onde: "sintomas em /ciclo" },
];

function log(linha) {
  process.stdout.write(`${linha}\n`);
}

async function main() {
  try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    log("QA_COPY_DATA BLOCKED reason=credenciais_ausentes");
    log("  Rode antes: npm run qa:env:local");
    return 2;
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    log(`QA_COPY_DATA BLOCKED reason=alvo_nao_local host=${host}`);
    return 2;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let total = 0;
  const achados = [];

  for (const catalogo of CATALOGOS) {
    const { data, error } = await admin
      .from(catalogo.tabela)
      .select("id,label")
      .is("owner_user_id", null)
      .order("label");
    if (error) {
      log(`QA_COPY_DATA BLOCKED reason=leitura_falhou tabela=${catalogo.tabela} code=${error.code ?? "?"}`);
      return 2;
    }
    const linhas = data ?? [];
    total += linhas.length;
    for (const linha of linhas) {
      for (const achado of auditarRotuloDeCatalogo(linha.label)) {
        achados.push({ tabela: catalogo.tabela, onde: catalogo.onde, rotulo: linha.label, ...achado });
      }
    }
    log(`  ${catalogo.tabela.padEnd(18)} ${String(linhas.length).padStart(3)} rotulos de sistema`);
  }

  log("");
  if (achados.length === 0) {
    log(`QA_COPY_DATA=PASS rotulos=${total} achados=0`);
    return 0;
  }

  for (const achado of achados) {
    const correcao = achado.sugestao ? ` -> "${achado.sugestao}"` : "";
    log(`  ${achado.regra.padEnd(8)} ${achado.tabela}: "${achado.rotulo}" (${achado.termo})${correcao}`);
    log(`           visivel em ${achado.onde}`);
  }
  log("");
  log(`QA_COPY_DATA=FAIL rotulos=${total} achados=${achados.length}`);
  log("  Corrija por migration aditiva, sempre pelo id estavel — nunca localizando a linha pelo texto.");
  return 1;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro) => {
    log(`QA_COPY_DATA BLOCKED reason=erro message=${String(erro?.message ?? erro).slice(0, 160)}`);
    process.exitCode = 2;
  });
