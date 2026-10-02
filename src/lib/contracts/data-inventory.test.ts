import { describe, expect, it } from "vitest";

import {
  DATA_DOMAINS,
  DATA_DOMAIN_DESCRIPTION,
  DATA_DOMAIN_LABEL,
  TABLE_DOMAIN,
  buildDataInventory,
} from "@/lib/contracts/data-inventory";
import { SUBJECT_EXPORT_REGISTRY } from "@/server/subject-export/registry";

/**
 * O guarda de completude do inventario.
 *
 * O painel de privacidade responde "o que existe sobre mim". A resposta so vale
 * se for **completa**, e completude nao se garante por revisao: garante-se por
 * um teste que reprova quando alguem cria tabela nova e esquece de dizer a que
 * dominio ela pertence.
 *
 * O registro do export ja tem o mesmo mecanismo — foi ele que obrigou
 * `notification_preferences` a ser classificada no Gate 23-A. Aqui a regra e
 * herdada: o que entra no export do titular entra no inventario dele.
 */
describe("cobertura do inventario", () => {
  const registryTables = SUBJECT_EXPORT_REGISTRY.map((item) => item.table);

  it("toda tabela exportavel tem dominio declarado", () => {
    const semDominio = registryTables.filter((table) => !TABLE_DOMAIN[table]);
    expect(semDominio).toEqual([]);
  });

  it("nenhum dominio aponta para tabela que o export nao conhece", () => {
    const inventadas = Object.keys(TABLE_DOMAIN).filter(
      (table) => !registryTables.includes(table as (typeof registryTables)[number]),
    );
    expect(inventadas).toEqual([]);
  });

  it("todo dominio tem rotulo e descricao em portugues", () => {
    for (const domain of DATA_DOMAINS) {
      expect(DATA_DOMAIN_LABEL[domain].trim().length).toBeGreaterThan(0);
      expect(DATA_DOMAIN_DESCRIPTION[domain].trim().length).toBeGreaterThan(0);
    }
  });
});

describe("montagem do inventario", () => {
  it("agrupa por dominio e soma o total", () => {
    const inventory = buildDataInventory({
      emotional_checkins: [{}, {}, {}],
      sleep_records: [{}],
      journal_entries: [{}, {}],
    });

    const emocional = inventory.domains.find((d) => d.domain === "emocional");
    expect(emocional?.records).toBe(4);
    expect(emocional?.tables).toEqual([
      { table: "emotional_checkins", records: 3 },
      { table: "sleep_records", records: 1 },
    ]);
    expect(inventory.total).toBe(6);
  });

  it("dominio vazio aparece com zero, e nao some", () => {
    const inventory = buildDataInventory({ goals: [] });
    const ciclo = inventory.domains.find((d) => d.domain === "ciclo");
    expect(ciclo).toBeDefined();
    expect(ciclo?.records).toBe(0);
    // "Voce nao tem nada de ciclo" e uma resposta; a linha ausente nao seria.
    expect(inventory.domains).toHaveLength(DATA_DOMAINS.length);
  });

  it("declara o que ficou de fora, em vez de fingir completude", () => {
    const inventory = buildDataInventory({}, ["audit_logs", "professional_notes"]);
    expect(inventory.excluded).toEqual(["audit_logs", "professional_notes"]);
  });
});
