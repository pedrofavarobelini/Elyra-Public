import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SUBJECT_EXPORT_EXCLUSIONS,
  SUBJECT_EXPORT_REGISTRY,
} from "@/server/subject-export/registry";



const ROOT = join(__dirname, "..");
const SOURCE_ROOT = join(ROOT, "src");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // Teste e fixture nao contam como consumidor: foi exatamente por conta-los
    // que os gaps passaram despercebidos.
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (/-fixtures\.ts$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Remove comentarios antes de procurar qualquer simbolo.
 *
 * Sem isto o guard se auto-dispara: os proprios comentarios que explicam o que
 * foi removido citam o nome do que foi removido. Mais importante, um simbolo
 * mencionado so em prosa **nao** e um consumidor — e exatamente a diferenca que
 * este arquivo existe para medir.
 *
 * Retira blocos `/* ... *\/` e linhas iniciadas por `//` ou `*`; nao toca em
 * `//` no meio de uma linha, para nao mutilar URLs e caminhos em strings.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const FILES = sourceFiles(SOURCE_ROOT).map((path) => ({
  path: relative(ROOT, path).split(sep).join("/"),
  text: stripComments(readFileSync(path, "utf8")),
}));

/** Arquivos que usam o simbolo sem serem o arquivo que o define. */
function consumersOf(symbol: string, definedIn: string): string[] {
  const usage = new RegExp(`\\b${symbol}\\b`);
  return FILES.filter(
    (file) => file.path !== definedIn && usage.test(file.text),
  ).map((file) => file.path);
}

function fileAt(path: string) {
  const found = FILES.find((file) => file.path === path);
  if (!found) throw new Error(`Arquivo ausente do produto: ${path}`);
  return found;
}

describe("o proprio guard discrimina", () => {
  // Sem isto, um `consumersOf` que devolvesse sempre algo faria os testes
  // abaixo passarem para sempre — e o guard seria decorativo.
  it("nao encontra consumidor para um simbolo que nao existe", () => {
    expect(consumersOf("interpretarSinaisQueNinguemChama", "")).toEqual([]);
  });

  it("nao conta o proprio arquivo de definicao como consumidor", () => {
    expect(
      consumersOf("runSessionAnalysis", "src/server/services/session-analysis-service.ts"),
    ).not.toContain("src/server/services/session-analysis-service.ts");
  });

  it("nao conta mencao em comentario como consumidor", () => {
    const commented = stripComments(
      "/** cita runSessionAnalysis em prosa */\n// e aqui tambem\nconst x = 1;",
    );
    expect(commented).not.toContain("runSessionAnalysis");
  });
});

describe("GAP-01 - o pipeline multimodal tem caminho executavel", () => {
  const chain: Array<[symbol: string, definedIn: string]> = [
    ["extractSessionSignals", "src/lib/multimodal-signals.ts"],
    ["buildObservableSignal", "src/lib/multimodal-signals.ts"],
    ["computeVoicedDurationMs", "src/lib/multimodal-signals.ts"],
    ["buildMultimodalInput", "src/lib/contracts/multimodal-signals.ts"],
    ["interpretSessionSignals", "src/server/pedrocore/client.ts"],
    ["startSessionTranscription", "src/lib/multimodal-derivation.ts"],
    ["startAudioEnvelopeCollection", "src/lib/multimodal-derivation.ts"],
    ["startFrameDifferenceCollection", "src/lib/multimodal-derivation.ts"],
    ["upsertSessionTranscript", "src/server/repositories/session-analysis-repository.ts"],
    ["upsertDerivedFeatures", "src/server/repositories/session-analysis-repository.ts"],
    ["insertSessionInterpretation", "src/server/repositories/session-analysis-repository.ts"],
    ["runSessionAnalysis", "src/server/services/session-analysis-service.ts"],
    ["getSessionAnalysis", "src/server/services/session-analysis-service.ts"],
  ];

  it.each(chain)("%s tem consumidor real no produto", (symbol, definedIn) => {
    expect(consumersOf(symbol, definedIn)).not.toHaveLength(0);
  });

  it("a fronteira do processamento existe como rota", () => {
    expect(
      fileAt("src/app/api/multimodal/sessions/[id]/analysis/route.ts").text,
    ).toContain("runSessionAnalysis");
  });

  it("a captura submete o que derivou on-device", () => {
    const capture = fileAt("src/app/(app)/sessoes/nova/capture-view.tsx").text;
    expect(capture).toContain("startSessionTranscription");
    expect(capture).toContain("startAudioEnvelopeCollection");
    expect(capture).toContain("startFrameDifferenceCollection");
    expect(capture).toContain("extractSessionSignals");
    expect(capture).toContain("/analysis");
  });

  it("a tela de resultado consome analise persistida", () => {
    expect(fileAt("src/app/(app)/sessoes/[id]/page.tsx").text).toContain(
      "getSessionAnalysis",
    );
  });

  it("as tres tabelas Stage 12 tem escrita fora do direito do titular", () => {
    for (const table of [
      "session_transcripts",
      "derived_features",
      "session_interpretations",
    ]) {
      const writers = FILES.filter(
        (file) =>
          file.text.includes(table) &&
          !file.path.includes("subject-rights-service") &&
          !file.path.includes("database.types"),
      );
      expect(writers.length).toBeGreaterThan(0);
    }
  });
});

describe("GAP-02 - o learning export tem gatilho executavel", () => {
  const chain: Array<[symbol: string, definedIn: string]> = [
    ["exportSnapshotForLearning", "src/server/services/learning-service.ts"],
    ["listLearningExports", "src/server/services/learning-service.ts"],
    ["revokeLearningExport", "src/server/services/learning-service.ts"],
    ["buildLearningSubmission", "src/lib/learning-pipeline.ts"],
  ];

  it.each(chain)("%s tem consumidor real no produto", (symbol, definedIn) => {
    expect(consumersOf(symbol, definedIn)).not.toHaveLength(0);
  });

  it("a rota de export existe e usa o servico governado", () => {
    const route = fileAt("src/app/api/learning/exports/route.ts").text;
    expect(route).toContain("exportSnapshotForLearning");
    expect(route).toContain("listLearningExports");
  });

  it("a UI oferece a contribuicao explicita", () => {
    const reports = fileAt("src/app/(app)/relatorios/view.tsx").text;
    expect(reports).toContain("/api/learning/exports");
    expect(reports).toContain("contribute-learning");
  });

  it("o gatilho e acao da pessoa, nao efeito do consentimento", () => {
    // Se o consentimento exportasse sozinho, `consentimento != elegibilidade !=
    // export` deixaria de valer. O PATCH de consentimento nao pode conhecer o
    // servico de export.
    expect(fileAt("src/app/api/learning/consent/route.ts").text).not.toContain(
      "exportSnapshotForLearning",
    );
  });
});

describe("GAP-03 - nao existe resultado fabricado no produto", () => {
  it("MOCK_SESSION_RESULT nao existe em lugar nenhum de src/", () => {
    expect(
      FILES.filter((file) => file.text.includes("MOCK_SESSION_RESULT")).map(
        (file) => file.path,
      ),
    ).toEqual([]);
  });

  it("o seed de sessoes sinteticas nao existe", () => {
    expect(
      FILES.filter((file) => /\bmockSessions\b/.test(file.text)).map(
        (file) => file.path,
      ),
    ).toEqual([]);
  });

  it("as metricas fabricadas nao sobrevivem em nenhuma tela", () => {
    for (const fabricated of [
      "124",
      "Atividade facial",
      "Hoje foi um dia corrido",
    ]) {
      const offenders = FILES.filter(
        (file) =>
          file.path.startsWith("src/app/") && file.text.includes(fabricated),
      );
      expect(offenders.map((file) => file.path)).toEqual([]);
    }
  });

  it("a rota de sessao so aceita identificador real", () => {
    const page = fileAt("src/app/(app)/sessoes/[id]/page.tsx").text;
    expect(page).toContain("notFound");
    // Id fora do formato nao cai em seed algum: cai em 404.
    expect(page).toMatch(/SESSION_ID\.test\(id\)/);
  });

  it("a lista de sessoes vem apenas do servidor", () => {
    const list = fileAt("src/app/(app)/sessoes/view.tsx").text;
    expect(list).toContain("/api/multimodal/sessions");
    expect(list).not.toMatch(/\bmockSessions\b/);
  });
});

describe("GAP-04 - notificacoes in-app tem caminho executavel", () => {
  const chain: Array<[symbol: string, definedIn: string]> = [
    [
      "materializeNotifications",
      "src/server/repositories/notifications-repository.ts",
    ],
    [
      "listNotifications",
      "src/server/repositories/notifications-repository.ts",
    ],
    [
      "countUnreadNotifications",
      "src/server/repositories/notifications-repository.ts",
    ],
    [
      "markNotificationRead",
      "src/server/repositories/notifications-repository.ts",
    ],
    [
      "getNotificationsSnapshot",
      "src/server/services/notifications-service.ts",
    ],
    ["readNotification", "src/server/services/notifications-service.ts"],
  ];

  it.each(chain)("%s tem consumidor real no produto", (symbol, definedIn) => {
    expect(consumersOf(symbol, definedIn)).not.toHaveLength(0);
  });

  it("o layout autenticado carrega snapshot real", () => {
    const layout = fileAt("src/app/(app)/layout.tsx").text;
    expect(layout).toContain("getNotificationsSnapshot");
    expect(layout).not.toContain("notificationCount={3}");
  });

  it("o sino consulta a API e executa a leitura explicita", () => {
    const bell = fileAt("src/components/layout/notification-bell.tsx").text;
    expect(bell).toContain('fetch("/api/notifications"');
    expect(bell).toContain('method: "PATCH"');
    expect(bell).toContain("Marcar como lida");
  });

  it("as duas rotas usam o service e autenticacao", () => {
    const listRoute = fileAt("src/app/api/notifications/route.ts").text;
    const readRoute = fileAt("src/app/api/notifications/[id]/route.ts").text;
    expect(listRoute).toContain("await getConsentedApiUser()");
    expect(listRoute).toContain("if (denial) return denial;");
    expect(listRoute).toContain("getNotificationsSnapshot");
    expect(readRoute).toContain("await getConsentedApiUser()");
    expect(readRoute).toContain("if (denial) return denial;");
    expect(readRoute).toContain("readNotification");
  });

  it("direito do titular inclui notifications conscientemente", () => {
    expect(fileAt("src/server/subject-export/registry.ts").text).toContain(
      'table: "notifications"',
    );
    expect(
      fileAt("src/server/services/subject-rights-service.ts").text,
    ).toContain("readSubjectExportData");
  });
});

describe("GAP-05 - o subject export roteia por ownership declarado", () => {
  const chain: Array<[symbol: string, definedIn: string]> = [
    ["SUBJECT_EXPORT_REGISTRY", "src/server/subject-export/registry.ts"],
    ["SUBJECT_EXPORT_EXCLUSIONS", "src/server/subject-export/registry.ts"],
    ["readSubjectExportData", "src/server/subject-export/exporter.ts"],
    ["SubjectExportRegistryError", "src/server/subject-export/exporter.ts"],
    [
      "buildSubjectDataExport",
      "src/server/services/subject-rights-service.ts",
    ],
  ];

  it.each(chain)("%s tem consumidor real no produto", (symbol, definedIn) => {
    expect(consumersOf(symbol, definedIn)).not.toHaveLength(0);
  });

  it("a rota do titular autentica, delega e sanitiza o erro", () => {
    const route = fileAt("src/app/api/me/export/route.ts").text;
    expect(route).toContain("await getConsentedApiUser()");
    expect(route).toContain("if (denial) return denial;");
    expect(route).toContain("buildSubjectDataExport");
    expect(route).toContain("Não foi possível gerar a exportação.");
    // O nome da tabela que falhou e estrutura interna: nao volta na resposta.
    expect(route).not.toContain("error.detail");
    expect(route).not.toContain("error.table");
  });

  it("o service delega ao registry em vez de reconstruir a lista", () => {
    const service = fileAt(
      "src/server/services/subject-rights-service.ts",
    ).text;
    expect(service).toContain("readSubjectExportData");
    expect(service).toContain("SUBJECT_EXPORT_EXCLUSIONS");
    // Causa do GAP-05: listas paralelas com coluna de ownership presumida.
    expect(service).not.toContain("OWNED_TABLES_BY_USER");
    expect(service).not.toContain("OWNED_TABLES_BY_PARENT");
    expect(service).not.toContain("DynamicReader");
  });

  it("o exporter nao presume nenhuma coluna de ownership", () => {
    const exporter = fileAt("src/server/subject-export/exporter.ts").text;
    expect(exporter).not.toContain('"user_id"');
    expect(exporter).not.toContain('"owner_user_id"');
    expect(exporter).not.toContain('"client_user_id"');
  });

  it("todo descriptor declara ownership e ordenacao explicitas", () => {
    expect(SUBJECT_EXPORT_REGISTRY.length).toBeGreaterThan(0);
    for (const descriptor of SUBJECT_EXPORT_REGISTRY) {
      expect(descriptor.ownership.kind).toBeTruthy();
      expect(descriptor.order.length).toBeGreaterThan(0);
    }
    for (const exclusion of SUBJECT_EXPORT_EXCLUSIONS) {
      expect(exclusion.reason.length).toBeGreaterThan(0);
    }
  });

  it("o coverage guard das tabelas publicas e exercitado por mutacao", () => {
    // Guard de CI: o consumidor legitimo e a suite, nao o runtime. O que precisa
    // ser provado aqui e que ele nao e decorativo — que existe mutacao que o
    // derruba, senao "34/34 classificadas" passaria para sempre.
    const suite = readFileSync(
      join(ROOT, "src/server/subject-export/exporter.test.ts"),
      "utf8",
    );
    expect(suite).toContain("evaluateSubjectExportCoverage");
    expect(suite).toContain("missing: [\"notifications\"]");
    expect(suite).toContain("future_private_table");
  });

  it("existe prova adversarial E2E do export do titular", () => {
    const spec = readFileSync(
      join(ROOT, "tests/e2e/subject-export-adversarial.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("/api/me/export");
  });
});
