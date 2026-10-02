import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { navigateTo, openNav } from "./nav";
import { createAnalyzedSession, removeSession } from "./real-session";

import { mockCycleRecords, mockPeriods } from "@/mocks/cycle-data";
import {
  installDeterministicMedia,
  resetMultimodalQa,
} from "./multimodal-mocks";




const mainNav = (page: Page) => openNav(page);

/**
 * Falha de fixture precisa dizer **o que** o servidor respondeu.
 *
 * `expect(res.ok()).toBe(true)` reprova com "esperado true, recebido false" -
 * o que nao distingue 400 de 500, nem revela a mensagem. Uma falha intermitente
 * diagnosticada assim vira "not-ok", que nao e diagnostico.
 */
async function esperarOk(res: APIResponse, oque: string) {
  if (res.ok()) return;
  const corpo = await res.text().catch(() => "<sem corpo>");
  throw new Error(
    `${oque} falhou: HTTP ${res.status()} ${res.statusText()} :: ${corpo.slice(0, 300)}`,
  );
}

/** Restaura a fixture persistente sem tocar em nenhum dado fora do ciclo. */
async function resetCycleFixture(page: Page) {
  await esperarOk(
    await page.request.patch("/api/cycle/profile", { data: { enabled: true } }),
    "habilitar ciclo",
  );
  await esperarOk(
    await page.request.delete("/api/cycle/data", { data: {} }),
    "excluir dados do ciclo",
  );

  for (const period of mockPeriods()) {
    await esperarOk(
      await page.request.post("/api/cycle/periods", {
        data: { startDate: period.startDate, endDate: period.endDate },
      }),
      `criar periodo ${period.startDate}`,
    );
  }
  for (const record of mockCycleRecords().slice(0, 2)) {
    await esperarOk(
      await page.request.post("/api/cycle/records", {
        data: {
          date: record.date,
          flow: record.flow,
          note: record.note,
          symptoms: [],
        },
      }),
      `criar registro ${record.date}`,
    );
  }

  await esperarOk(
    await page.request.patch("/api/cycle/profile", { data: { enabled: false } }),
    "desabilitar ciclo",
  );
}

/** Liga o acompanhamento do ciclo pelo caminho real do usuario. */
async function enableCycle(page: Page) {
  await gotoHydrated(page, "/configuracoes");
  await page.getByRole("switch", { name: "Acompanhamento do ciclo" }).click();
  await page.getByRole("link", { name: "Abrir o ciclo" }).click();
  await expect(
    page.getByRole("heading", { name: "Ciclo", level: 1 }),
  ).toBeVisible();
}

/** Habilita o modulo de sessoes - sem conceder nenhuma captura. */
async function enableSessions(page: Page) {
  await gotoHydrated(page, "/configuracoes");
  await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
  await page.getByRole("link", { name: "Preparar uma sessão" }).click();
  await expect(
    page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true }),
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// Ciclo - opt-in
// ---------------------------------------------------------------------------

test.describe("Ciclo - opt-in", () => {
  test.beforeEach(async ({ page }) => {
    await resetCycleFixture(page);
  });

  test("o modulo nasce desativado e a rota mostra o convite", async ({
    page,
  }) => {
    await gotoHydrated(page, "/ciclo");
    await expect(
      page.getByRole("heading", { name: "Acompanhe seu ciclo", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ativar acompanhamento" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Agora não" })).toBeVisible();

    // Nenhum dado do ciclo aparece antes do consentimento.
    await expect(page.getByText("Dia 20 de 28")).toHaveCount(0);
  });

  test("o opt-in e a tela inteira e traz o aviso nao clinico", async ({
    page,
  }) => {
    await gotoHydrated(page, "/ciclo");
    const notice = page.getByRole("note").first();
    await expect(notice).toContainText(/não é um diagnóstico médico/i);
    await expect(
      page.getByText(/pode ativar ou desativar este acompanhamento/i),
    ).toBeVisible();
  });

  test("'Agora nao' sai sem ativar", async ({ page }) => {
    await gotoHydrated(page, "/ciclo");
    await page.getByRole("button", { name: "Agora não" }).click();
    await expect(
      page.getByRole("heading", { name: "Olá, Demo", level: 1 }),
    ).toBeVisible();

    await navigateTo(page, "Dashboard");
    await expect(
      page.getByRole("heading", { name: "Acompanhe seu ciclo", level: 3 }),
    ).toBeVisible();
  });

  test("ativar abre o ciclo e o dashboard passa a mostrar o card", async ({
    page,
  }) => {
    await gotoHydrated(page, "/ciclo");
    await page.getByRole("button", { name: "Ativar acompanhamento" }).click();
    await expect(
      page.getByRole("heading", { name: "Ciclo", level: 1 }),
    ).toBeVisible();

    await navigateTo(page, "Dashboard");
    await expect(
      page.getByRole("heading", { name: "Seu ciclo", level: 3 }),
    ).toBeVisible();
  });

  test("desativar preserva os dados; excluir e um fluxo separado", async ({
    page,
  }) => {
    await enableCycle(page);
    await expect(page.getByRole("group", { name: "Ciclo atual" })).toContainText(
      "Dia",
    );

    // Desativar: o modulo some, os dados ficam.
    await navigateTo(page, "Perfil");

    await page.getByRole("main").getByRole("link", { name: "Configurações" }).click();
    await page.getByRole("switch", { name: "Acompanhamento do ciclo" }).click();
    await expect(
      page.getByRole("switch", { name: "Acompanhamento do ciclo" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByText(/Você tem 3 períodos e \d+ registros diários guardados/),
    ).toBeVisible();

    // Reativar recupera o historico intacto.
    await page.getByRole("switch", { name: "Acompanhamento do ciclo" }).click();
    await page.getByRole("link", { name: "Abrir o ciclo" }).click();
    await expect(page.getByRole("group", { name: "Ciclo atual" })).toContainText(
      "Dia",
    );
  });

  test("excluir dados do ciclo exige confirmacao explicita", async ({
    page,
  }) => {
    await enableCycle(page);
    await navigateTo(page, "Perfil");

    await page.getByRole("main").getByRole("link", { name: "Configurações" }).click();

    await page.getByRole("button", { name: "Excluir dados do ciclo" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/não pode ser desfeita/i);
    await expect(dialog).toContainText(/diferente de desativar/i);

    // Cancelar preserva.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText(/Você tem 3 períodos/)).toBeVisible();

    // Confirmar apaga - e o card de dados desaparece.
    await page.getByRole("button", { name: "Excluir dados do ciclo" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Excluir em definitivo" })
      .click();
    await expect(page.getByText(/Você tem 3 períodos/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Ciclo - estimativas e linguagem
// ---------------------------------------------------------------------------

test.describe("Ciclo - estimativa e linguagem", () => {
  test.beforeEach(async ({ page }) => {
    await resetCycleFixture(page);
    await enableCycle(page);
  });

  test("toda previsao e rotulada como estimativa", async ({ page }) => {
    const proxima = page.getByRole("group", {
      name: "Próxima menstruação estimada",
    });
    await expect(proxima).toContainText("Em aproximadamente");
    await expect(proxima).toContainText("estimativa, não uma certeza");

    await expect(page.getByRole("group", { name: "Ciclo atual" })).toContainText(
      "(estimada)",
    );
  });

  test("a tela declara que nao serve para contracepcao nem fertilidade", async ({
    page,
  }) => {
    const aviso = page.getByTestId("cycle-estimate-disclaimer");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(/não é método contraceptivo/i);
    await expect(aviso).toContainText(/não indica fertilidade/i);
    await expect(aviso).toContainText(/estimativas/i);
  });

  test("o calendario distingue menstruacao registrada de estimada", async ({
    page,
  }) => {
    // `exact` porque "Proxima menstruacao estimada" contem o mesmo texto.
    await expect(
      page.getByText("Menstruação estimada", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Menstruação registrada", { exact: true }),
    ).toBeVisible();
  });

  test("o insight fala em associacao temporal, nunca em causa", async ({
    page,
  }) => {
    await expect(page.getByText(/associação temporal/i).first()).toBeVisible();

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const proibido of ["causou", "por causa de", "provoca", "causa disso"]) {
      expect(body, `linguagem causal encontrada: "${proibido}"`).not.toContain(
        proibido,
      );
    }
  });

  test("o ciclo nao duplica humor, ansiedade, energia nem sono", async ({
    page,
  }) => {
    // As metricas aparecem no painel do dia, mas declaradas como de outro
    // dominio - o ciclo nao guarda uma segunda copia delas.
    await expect(
      page.getByText(/pertencem aos seus próprios registros, não ao ciclo/i),
    ).toBeVisible();
  });

  test("registrar dados do dia usa um registro por data", async ({ page }) => {
    await page.getByRole("button", { name: "Registrar dados" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // "Sem registro" e uma escolha explicita de fluxo, nao um zero.
    await expect(
      dialog.getByRole("button", { name: "Sem registro" }),
    ).toHaveAttribute("aria-pressed", "true");

    await dialog.getByRole("button", { name: "Moderado" }).click();
    await dialog.getByRole("button", { name: "Cólica", exact: false }).click();
    await dialog.getByLabel("Observação").fill("Registro E2E do ciclo.");
    await dialog.getByRole("button", { name: "Salvar registro" }).click();

    await expect(page.getByText("Registro E2E do ciclo.")).toBeVisible();
  });

  test("permite criar sintoma proprio", async ({ page }) => {
    await page.getByRole("button", { name: "Registrar dados" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Criar sintoma próprio").fill("Tontura leve");
    await dialog.getByRole("button", { name: "Adicionar sintoma" }).click();

    const criado = dialog.getByRole("button", { name: /Tontura leve/ });
    await expect(criado).toHaveAttribute("aria-pressed", "true");
    await expect(criado).toContainText("seu");
  });
});

// ---------------------------------------------------------------------------
// Relatorios
// ---------------------------------------------------------------------------

test.describe("Relatorios", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/relatorios");
  });

  test("renderiza com filtros, grafico e comparacao de periodo", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Relatórios e evolução", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Humor médio" }),
    ).toContainText("vs. período anterior");
  });

  test("os filtros de metrica sao independentes", async ({ page }) => {
    // L-263: "Humor" tambem nomeia o filtro de cruzamentos; o alvo e o grupo do grafico.
    const metricas = page.getByRole("group", { name: "Métricas exibidas no gráfico" });
    const humor = metricas.getByRole("button", { name: /^Humor/ });
    const ansiedade = metricas.getByRole("button", { name: /^Ansiedade/ });

    await expect(humor).toHaveAttribute("aria-pressed", "true");
    await expect(ansiedade).toHaveAttribute("aria-pressed", "true");

    await humor.click();
    await expect(humor).toHaveAttribute("aria-pressed", "false");
    await expect(ansiedade).toHaveAttribute("aria-pressed", "true");
  });

  test("sem metrica selecionada o grafico nao inventa dado", async ({
    page,
  }) => {
    const metricas = page.getByRole("group", { name: "Métricas exibidas no gráfico" });
    for (const name of [/^Humor/, /^Ansiedade/]) {
      await metricas.getByRole("button", { name }).click();
    }
    await expect(
      page.getByText("Selecione ao menos uma métrica"),
    ).toBeVisible();
  });

  test("os insights descrevem coincidencia, nunca causa", async ({ page }) => {
    // A identidade nasce com o ciclo desligado; o insight de associacao so
    // existe com ele ligado. Sem isto o teste dependia da ordem do arquivo.
    await esperarOk(
      await page.request.patch("/api/cycle/profile", { data: { enabled: true } }),
      "habilitar ciclo",
    );
    try {
      await gotoHydrated(page, "/relatorios");
      await expect(
        page.getByText(/coincidiram com|associação temporal/i).first(),
      ).toBeVisible();

      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const proibido of ["causou", "por causa de", "provoca"]) {
        expect(body, `linguagem causal encontrada: "${proibido}"`).not.toContain(
          proibido,
        );
      }
    } finally {
      await esperarOk(
        await page.request.patch("/api/cycle/profile", { data: { enabled: false } }),
        "desabilitar ciclo",
      );
    }
  });

  test("traz o aviso nao clinico do relatorio", async ({ page }) => {
    await expect(
      page.getByText(/não representa diagnóstico, avaliação clínica/i),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Sessoes multimodais - privacidade
// ---------------------------------------------------------------------------

test.describe("Sessoes multimodais - privacidade", () => {
  test.beforeEach(async ({ page }) => {
    await resetMultimodalQa(page);
    await installDeterministicMedia(page);
  });

  test.afterEach(async ({ page }) => {
    await resetMultimodalQa(page);
  });
  test("o modulo nasce desativado e a rota mostra o portao", async ({
    page,
  }) => {
    await gotoHydrated(page, "/sessoes");
    await expect(
      page.getByRole("heading", { name: "Ativar as sessões multimodais", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ativar sessões multimodais" }),
    ).toBeVisible();
  });

  test("habilitar a feature NAO concede tela, camera nem microfone", async ({
    page,
  }) => {
    // Revisao obrigatoria do Tech Lead: `sessionsEnabled` e uma decisao;
    // `screen`, `camera` e `microphone` sao outras tres. Ativar o modulo em
    // Configuracoes nao pode conceder nenhuma delas.
    await gotoHydrated(page, "/configuracoes");
    const feature = page.getByRole("switch", {
      name: "Sessões multimodais (Beta)",
    });
    await expect(feature).toHaveAttribute("aria-checked", "false");

    await feature.click();
    await expect(feature).toHaveAttribute("aria-checked", "true");

    await page.getByRole("link", { name: "Preparar uma sessão" }).click();

    for (const name of [
      "Gravar/compartilhar tela",
      "Usar câmera",
      "Usar microfone",
      "Gerar transcrição",
      "Guardar gravação após análise",
    ]) {
      await expect(
        page.getByRole("switch", { name }),
        `${name} deveria continuar desligado apos habilitar o modulo`,
      ).toHaveAttribute("aria-checked", "false");
    }

    // Sem nenhuma captura autorizada, a sessao nao pode comecar.
    await expect(
      page.getByRole("button", { name: "Iniciar sessão" }),
    ).toBeDisabled();
    await expect(page.getByTestId("capture-required")).toBeVisible();
  });

  test("tela, camera e microfone sao permissoes independentes", async ({
    page,
  }) => {
    await enableSessions(page);

    const tela = page.getByRole("switch", { name: "Gravar/compartilhar tela" });
    const camera = page.getByRole("switch", { name: "Usar câmera" });
    const microfone = page.getByRole("switch", { name: "Usar microfone" });

    await tela.click();
    await expect(tela).toHaveAttribute("aria-checked", "true");
    await expect(camera).toHaveAttribute("aria-checked", "false");
    await expect(microfone).toHaveAttribute("aria-checked", "false");

    await microfone.click();
    await expect(camera).toHaveAttribute("aria-checked", "false");

    // Autorizar a tela dispara o aviso de conteudo sensivel.
    await expect(
      page.getByText(/pode incluir notificações, mensagens ou informações sensíveis/i),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Iniciar sessão" }),
    ).toBeEnabled();
  });

  test("resultado, transcricao e midia sao autorizacoes separadas", async ({
    page,
  }) => {
    await enableSessions(page);

    const resultado = page.getByRole("switch", {
      name: "Compartilhar resultado com profissional",
    });
    const transcricao = page.getByRole("switch", {
      name: "Compartilhar transcrição com profissional",
    });
    const gravacao = page.getByRole("switch", {
      name: "Compartilhar gravação original com profissional",
    });

    for (const s of [resultado, transcricao, gravacao]) {
      await expect(s).toHaveAttribute("aria-checked", "false");
    }

    await resultado.click();
    await expect(resultado).toHaveAttribute("aria-checked", "true");
    await expect(transcricao).toHaveAttribute("aria-checked", "false");
    await expect(gravacao).toHaveAttribute("aria-checked", "false");

    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: "Gerar transcrição" }).click();
    await transcricao.click();
    await expect(gravacao).toHaveAttribute("aria-checked", "false");
  });

  test("desativar o modulo revoga as permissoes de captura", async ({
    page,
  }) => {
    await enableSessions(page);
    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await expect(
      page.getByRole("switch", { name: "Usar câmera" }),
    ).toHaveAttribute("aria-checked", "true");

    await navigateTo(page, "Perfil");

    await page.getByRole("main").getByRole("link", { name: "Configurações" }).click();
    await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
    await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
    await page.getByRole("link", { name: "Preparar uma sessão" }).click();

    // Reativar nao restaura o consentimento anterior.
    await expect(
      page.getByRole("switch", { name: "Usar câmera" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("a sessao em andamento reflete apenas o que foi autorizado", async ({
    page,
  }) => {
    await enableSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();

    await expect(
      page.getByRole("heading", { name: "Nova sessão multimodal", level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    await expect(page.getByTestId("capture-state-camera")).toHaveCount(0);
    await expect(page.getByTestId("capture-state-screen")).toHaveCount(0);
    await expect(
      page.getByText(/Compartilhamento de tela desativado/i),
    ).toBeVisible();
  });

  test("o preflight nao solicita dispositivo antes do gesto explicito", async ({
    page,
  }) => {

    // coleta antes de existir backend, consentimento versionado e Storage.
    await page.addInitScript(() => {
      (window as unknown as { __mediaCalls: number }).__mediaCalls = 0;
      const nav = navigator as unknown as {
        mediaDevices?: { getUserMedia?: unknown; getDisplayMedia?: unknown };
      };
      if (nav.mediaDevices) {
        nav.mediaDevices.getUserMedia = () => {
          (window as unknown as { __mediaCalls: number }).__mediaCalls += 1;
          return Promise.reject(new Error("bloqueado no teste"));
        };
        nav.mediaDevices.getDisplayMedia = nav.mediaDevices.getUserMedia;
      }
    });

    await enableSessions(page);
    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(
      page.getByRole("heading", { name: "Nova sessão multimodal", level: 1 }),
    ).toBeVisible();

    const calls = await page.evaluate(
      () => (window as unknown as { __mediaCalls: number }).__mediaCalls,
    );
    expect(calls).toBe(0);
  });

  test("a sessao pode ser pausada e finalizada com confirmacao", async ({
    page,
  }) => {
    await enableSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();

    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();

    await page.getByRole("button", { name: "Pausar sessão" }).click();
    await expect(page.getByText("PAUSADA")).toBeVisible();
    await page.getByRole("button", { name: "Retomar sessão" }).click();
    await expect(page.getByText("REC", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/nenhuma mídia será enviada/i);
    await dialog.getByRole("button", { name: "Finalizar sessão" }).click();

    // ela nao para mais na captura, ela mostra a analise real da sessao.
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Resultado da sessao
// ---------------------------------------------------------------------------


test.describe("Resultado da sessao", () => {
  let sessionId = "";

  test.beforeEach(async ({ page }) => {
    sessionId = await createAnalyzedSession(page);
    await gotoHydrated(page, `/sessoes/${sessionId}`);
  });

  test.afterEach(async ({ page }) => {
    if (sessionId) await removeSession(page, sessionId);
  });

  test("descreve sinais observaveis, nunca emocao detectada", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sinais observáveis" }),
    ).toBeVisible();
    await expect(page.getByText("Ritmo de fala")).toBeVisible();

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const proibido of [
      "% de tristeza",
      "emocao detectada",
      "detectou que voce esta",
      "diagnostico de",
      "atividade facial",
    ]) {
      expect(body, `linguagem proibida: "${proibido}"`).not.toContain(proibido);
    }
  });

  test("compara apenas com a media pessoal de quem fez a sessao", async ({
    page,
  }) => {
    const signals = page.getByTestId("signals-state");
    await expect(signals).toBeVisible();
    // Primeira sessao da conta: sem historico nao existe comparacao, e a tela
    // diz isso em vez de chamar o valor de normal.
    await expect(signals).toContainText(/média pessoal|sessões suficientes/i);

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const proibido of ["media da populacao", "norma populacional", "acima da media geral"]) {
      expect(body, `comparacao proibida: "${proibido}"`).not.toContain(proibido);
    }
  });

  test("a transcricao exibida e a que foi persistida", async ({ page }) => {
    await expect(page.getByTestId("transcript-state")).toContainText(
      "minha rotina de estudos",
    );
  });

  test("traz o aviso nao clinico da sessao", async ({ page }) => {
    await expect(
      page.getByText(/não determina um estado emocional/i),
    ).toBeVisible();
  });

  test("uma sessao inexistente nao inventa resultado", async ({ page }) => {
    const response = await page.goto("/sessoes/999");
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Area profissional
// ---------------------------------------------------------------------------

async function openFirstProfessionalPatient(page: Page) {
  await gotoHydrated(page, "/pro/acompanhamentos");
  await page.getByRole("link", { name: /Abrir dossiê/i }).first().click();
  await page.waitForLoadState("load");
}

test.describe("Area profissional", () => {
  test("troca o conjunto de navegacao", async ({ page }) => {
    await gotoHydrated(page, "/pro/acompanhamentos");
    const nav = await mainNav(page);

    for (const label of [
      "Dashboard",
      "Acompanhamentos",
      "Agenda",
      "Sessões",
      "Relatórios e evolução",
      "Central de solicitações",
      "Vínculos e acessos",
      "Perfil profissional",
      "Configurações",
    ]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(1);
    }
    // Nada de funcionalidade que ainda nao existe (Agenda PRO-6 e Sessoes PRO-7, ADR-0024).
    for (const absent of ["Pedidos de ajuda", "Pacientes"]) {
      await expect(nav.getByRole("link", { name: absent, exact: true })).toHaveCount(0);
    }

    // Itens do contexto do usuario final nao aparecem aqui.
    await expect(nav.getByRole("link", { name: "Diário" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Meu Humor" })).toHaveCount(0);
  });

  test("'nao compartilhado' e um estado visivel", async ({ page }) => {
    await openFirstProfessionalPatient(page);
    await expect(
      page.getByRole("heading", { name: "Ana Paula QA", level: 1 }),
    ).toBeVisible();

    await expect(page.getByTestId("sharing-multimodal_media")).toHaveText(
      "Não compartilhado",
    );
    await expect(page.getByTestId("sharing-emotional")).toHaveText(
      "Compartilhado",
    );
  });

  test("escopos multimodais permanecem independentes", async ({ page }) => {
    await openFirstProfessionalPatient(page);
    await expect(page.getByTestId("sharing-multimodal_result")).toHaveText(
      "Compartilhado",
    );
    await expect(page.getByTestId("sharing-multimodal_transcript")).toHaveText(
      "Não compartilhado",
    );
    await expect(page.getByTestId("sharing-multimodal_media")).toHaveText(
      "Não compartilhado",
    );
  });


  test("Era 3 - ausencia de permissao nao se parece com ausencia de registro", async ({
    page,
  }) => {
    await openFirstProfessionalPatient(page);

    /*
      A identidade QA concede todos os escopos que tem aba, entao o estado
      "nao compartilhado" nao e alcancavel por clique aqui - ele e verificado no
      cracha (`sharing-multimodal_media`) e, nos dois estados, no teste de
      componente de `DataTab`.

      O que este teste tranca e o outro lado, que **e** alcancavel: compartilhado
      e vazio precisa dizer que esta vazio, e nao insinuar falta de permissao.
    */
    await page.getByRole("tab", { name: "Sessões" }).click();


    await expect(
      page.getByText(/nenhuma sessão foi registrada/i),
    ).toBeVisible();
    await expect(
      page.getByText(/você tem permissão para este dado/i),
    ).toBeVisible();
    await expect(
      page.getByText(/não é ausência de permissão/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Não disponível para este acesso/i),
    ).toHaveCount(0);
  });


  test("Era 3 - o dossie diz se aquilo e registro ou calculo", async ({ page }) => {
    await openFirstProfessionalPatient(page);

    await page.getByRole("tab", { name: /Sono/ }).click();
    await expect(page.getByTestId("layer-sono")).toHaveText("Registro da pessoa");

    await page.getByRole("tab", { name: /Relatórios/ }).click();
    await expect(page.getByTestId("layer-relatorios")).toHaveText(
      "Cálculo da Elyra",
    );


    await expect(page.getByText("Leitura de modelo")).toHaveCount(0);
  });

  test("sem conexao do cliente a configuracao permanece deny", async ({ page }) => {

    await gotoHydrated(page, "/configuracoes/privacidade");
    await expect(page.getByText(/Nenhuma conexão/i)).toBeVisible();
    await expect(
      page.getByText(/todas as consultas profissionais são negadas/i),
    ).toBeVisible();
  });

  test("o dossie declara que os sinais nao representam diagnostico", async ({
    page,
  }) => {
    await openFirstProfessionalPatient(page);
    await expect(
      page.getByText(/não representam diagnóstico/i).first(),
    ).toBeVisible();
  });

  test("o cockpit profissional so mostra numero sustentado pelo banco", async ({
    page,
  }) => {

    await gotoHydrated(page, "/pro/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /1\s*Acompanhamentos ativos/ })).toBeVisible();
    await expect(page.getByText(/Agenda de hoje|Sessões de hoje/)).toHaveCount(0);
  });
});
