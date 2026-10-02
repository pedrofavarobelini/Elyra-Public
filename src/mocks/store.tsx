"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  EMPTY_OLDER_COUNTS,
  HISTORY_DOMAIN,
  PERSONAL_WINDOW_DAYS,
  personalWindowStart,
  type HistoryDomain,
  type PersonalWindowInfo,
} from "@/lib/contracts/personal-window";
import { NetworkUnavailableError } from "@/lib/network-status";
import {
  OUTBOX_DOMAIN,
  OUTBOX_KIND,
  cycleRecordContent,
  fingerprint,
  goalEditContent,
  goalStatusContent,
  journalContent,
  sleepContent,
  type OutboxOperation,
} from "@/lib/offline/contracts";
import {
  OnlineWriteError,
  WRITE_STATUS,
  type GatewayState,
  type OfflineGateway,
  type WriteSpec,
} from "@/lib/offline/gateway";
import {
  applyOperations,
  reconcileAck,
  type PersonalSlices,
} from "@/lib/offline/local-apply";

import type {
  CycleDailyRecord,
  CycleDailyRecordInput,
  CyclePeriod,
  CycleProfile,
  CycleSnapshot,
  CycleSymptom,
} from "@/lib/contracts/cycle";
import type {
  EmotionalCheckin,
  EmotionalCheckinInput,
  EmotionalFactor,
  EmotionalSnapshot,
  SleepRecord,
  SleepRecordInput,
} from "@/lib/contracts/emotional";
import type {
  AppUser,
  ProfileUpdateInput,
  PreferencesUpdateInput,
  UserPreferences,
} from "@/lib/contracts/identity";
import {
  canTransitionGoalStatus,
  toDay,
  type Goal,
  type GoalInput,
  type GoalProgressEntry,
  type GoalsSnapshot,
} from "@/lib/contracts/goals";
import type {
  JournalEntry,
  JournalEntryInput,
  JournalSnapshot,
  JournalTag,
} from "@/lib/contracts/journal";
import type {
  SessionSetup,
} from "@/lib/contracts/session";
import { DEFAULT_SESSION_SETUP } from "@/lib/contracts/session";
import type {
  ShareableCategory,
  SharingState,
} from "@/lib/contracts/sharing";
import { DEFAULT_SHARING } from "@/lib/contracts/sharing";
import {
  CUSTOM_SYMPTOMS,
  mockCycleRecords,
  mockPeriods,
  SYSTEM_SYMPTOMS,
} from "@/mocks/cycle-data";
import {
  CUSTOM_FACTORS,
  CUSTOM_TAGS,
  MOCK_CHECKINS,
  MOCK_GOALS,
  MOCK_GOAL_PROGRESS,
  MOCK_JOURNAL,
  MOCK_SLEEP,
  MOCK_USER,
  SYSTEM_FACTORS,
  SYSTEM_TAGS,
} from "@/mocks/data";



interface MockState {
  user: AppUser;
  preferences: UserPreferences;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  factors: EmotionalFactor[];
  journal: JournalEntry[];
  tags: JournalTag[];
  goals: Goal[];
  goalProgress: GoalProgressEntry[];
  cycle: CycleProfile;
  periods: CyclePeriod[];
  cycleRecords: CycleDailyRecord[];
  symptoms: CycleSymptom[];

  window: PersonalWindowInfo;
  loadingOlder: boolean;
  /**
   * Existencia do modulo de sessoes. **Nao** e permissao de captura: tela,
   * camera e microfone vivem em `sessionSetup` e sao escolhidos um a um no
   * preflight de cada sessao.
   */
  sessionsEnabled: boolean;
  sessionSetup: SessionSetup;
  sharing: SharingState;

  isPendingSync: (entityId: string) => boolean;
  /** `null` sem gateway; `shell` na pagina offline. */
  offlineMode: "online" | "shell" | null;
}

interface MockActions {

  loadOlderHistory: (domains: readonly HistoryDomain[]) => Promise<number>;
  updateProfile: (input: ProfileUpdateInput) => Promise<AppUser>;
  updatePreferences: (
    input: PreferencesUpdateInput,
  ) => Promise<UserPreferences>;
  addCheckin: (input: EmotionalCheckinInput) => Promise<EmotionalCheckin>;
  /** Corrige um check-in passado. `occurredAt` ausente mantem a data original. */
  editCheckin: (
    input: EmotionalCheckinInput & { id: string; occurredAt?: string },
  ) => Promise<EmotionalCheckin>;
  addSleep: (input: SleepRecordInput) => Promise<SleepRecord>;
  addCustomFactor: (label: string) => Promise<EmotionalFactor>;
  saveJournal: (
    input: JournalEntryInput,
    options?: { id?: string; status?: JournalEntry["status"] },
  ) => Promise<JournalEntry>;
  addCustomTag: (label: string) => Promise<JournalTag>;
  trashJournal: (id: string) => Promise<JournalEntry>;
  restoreJournal: (id: string) => Promise<JournalEntry>;
  purgeJournal: (id: string) => Promise<{ id: string }>;
  addGoal: (input: GoalInput) => Promise<Goal>;
  setGoalStatus: (id: string, status: Goal["status"]) => Promise<Goal>;

  editGoal: (input: { id: string; title: string; target: number; unit: string | null }) => Promise<Goal>;
  addGoalProgress: (goalId: string, amount: number) => Promise<GoalProgressEntry>;
  /** Opt-in explicito. Idempotente. */
  enableCycle: () => Promise<CycleProfile>;
  /** Desativa o modulo **preservando** os dados. */
  disableCycle: () => Promise<CycleProfile>;
  /** Exclusao explicita e separada da desativacao. Apaga periodos e registros. */
  deleteCycleData: () => Promise<{ deleted: unknown }>;
  /** Upsert por data: um registro por usuario/data. */
  saveCycleRecord: (input: CycleDailyRecordInput) => Promise<CycleDailyRecord>;
  deleteCycleRecord: (date: string) => Promise<{ id: string; date: string }>;
  addCustomSymptom: (label: string) => Promise<CycleSymptom>;
  /** Liga/desliga o modulo. Nunca toca nas permissoes de captura. */
  setSessionsEnabled: (on: boolean) => Promise<void>;
  updateSessionSetup: (patch: Partial<SessionSetup>) => void;
  /**
   * Devolve a preparacao ao padrao: **toda permissao desligada**.
   *
   * Chamada depois de a sessao ser criada. Sem isso, o consentimento de uma
   * sessao sobrevivia a navegacao e chegava ligado na proxima - a pessoa
   * autorizava camera e gravacao uma vez, e a sessao seguinte ja nascia com as
   * duas marcadas sem ninguem decidir de novo.
   *
   * Nao altera a sessao recem-criada: ela ja tem o consentimento persistido no
   * servidor, e ele descreve o que de fato foi autorizado naquela sessao.
   */
  resetSessionSetup: () => void;
  setSharing: (category: ShareableCategory, on: boolean) => void;
}

type MockStore = MockState & MockActions;

const MockContext = createContext<MockStore | null>(null);

type BaseSlices = PersonalSlices & { periods: CyclePeriod[] };

const EMPTY_BASE: BaseSlices = {
  checkins: [],
  sleep: [],
  journal: [],
  goals: [],
  goalProgress: [],
  cycleRecords: [],
  periods: [],
};

const EMPTY_GATEWAY_STATE: GatewayState = {
  connectivity: "ONLINE",
  operations: [],
  syncing: false,
  lastSyncedAt: null,
  storageAvailable: true,
};
const emptyGatewayState = () => EMPTY_GATEWAY_STATE;
const noopSubscribe = () => () => undefined;

/** `{ data }` das respostas da API. */
function dataOf<T>(body: unknown): T {
  return (body as { data: T }).data;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  checkinReminder: true,
  goalReminder: true,
  sessionsEnabled: false,
  primaryGoal: null,
};

async function requestJson<T>(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
): Promise<T> {
  /*
    Falha de transporte e falha de servidor sao coisas diferentes.

    Um `fetch` que rejeita nao chegou a lugar nenhum — e a rede caindo, o tunel
    expirando, o telefone trocando de Wi-Fi para dados. Sem esta distincao, a
    tela mostrava a string do navegador ("Failed to fetch"), em ingles, com cara
    de recusa; agora ela diz que faltou conexao e que o que foi escrito continua
    ali. Nenhum retry acontece aqui: repetir e gesto da pessoa.
  */
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new NetworkUnavailableError(path, cause);
  }

  const payload = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error ?? "Não foi possível salvar.");
  }
  return payload.data;
}

/** 409 na edicao de meta: `latest` e a versao atual (null = removida em outro aparelho). */
export class GoalEditConflictError extends Error {
  constructor(readonly latest: Goal | null) {
    super("Esta meta foi alterada em outro dispositivo.");
    this.name = "GoalEditConflictError";
  }
}

export function MockProvider({
  children,
  initialUser = MOCK_USER,
  initialPreferences = DEFAULT_PREFERENCES,
  initialEmotional,
  initialJournal,
  initialGoals,
  initialCycle,
  initialWindow,
  gateway,
}: {
  children: ReactNode;

  gateway?: OfflineGateway;
  initialUser?: AppUser;
  initialPreferences?: UserPreferences;
  initialEmotional?: EmotionalSnapshot;
  initialJournal?: JournalSnapshot;
  initialGoals?: GoalsSnapshot;
  initialCycle?: CycleSnapshot;
  /** Metadados da janela vindos do layout; ausente = historia inteira em memoria. */
  initialWindow?: PersonalWindowInfo;
}) {
  const [windowInfo, setWindowInfo] = useState<PersonalWindowInfo>(
    initialWindow ?? {
      days: PERSONAL_WINDOW_DAYS,
      since: personalWindowStart(),
      hasOlder: false,
      olderCounts: EMPTY_OLDER_COUNTS,
    },
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [user, setUser] = useState<AppUser>(initialUser);
  const [preferences, setPreferences] =
    useState<UserPreferences>(initialPreferences);
  const [checkins, setCheckins] = useState<EmotionalCheckin[]>(
    initialEmotional?.checkins ?? MOCK_CHECKINS,
  );
  const [sleep, setSleep] = useState<SleepRecord[]>(
    initialEmotional?.sleep ?? MOCK_SLEEP,
  );
  const [factors, setFactors] = useState<EmotionalFactor[]>(
    initialEmotional?.factors ?? [...SYSTEM_FACTORS, ...CUSTOM_FACTORS],
  );
  const [journal, setJournal] = useState<JournalEntry[]>(
    initialJournal?.entries ?? MOCK_JOURNAL,
  );
  const [tags, setTags] = useState<JournalTag[]>(
    initialJournal?.tags ?? [...SYSTEM_TAGS, ...CUSTOM_TAGS],
  );
  const [goals, setGoals] = useState<Goal[]>(initialGoals?.goals ?? MOCK_GOALS);
  const [goalProgress, setGoalProgress] =
    useState<GoalProgressEntry[]>(initialGoals?.progress ?? MOCK_GOAL_PROGRESS);

  // O modulo de ciclo nasce DESLIGADO. Opt-in nunca e presumido.
  const [cycle, setCycle] = useState<CycleProfile>(
    initialCycle?.profile ?? { enabled: false, optedInAt: null },
  );
  const [periods, setPeriods] = useState<CyclePeriod[]>(
    initialCycle?.periods ?? mockPeriods,
  );
  const [cycleRecords, setCycleRecords] =
    useState<CycleDailyRecord[]>(initialCycle?.records ?? mockCycleRecords);
  const [symptoms, setSymptoms] = useState<CycleSymptom[]>(
    initialCycle?.symptoms ?? [...SYSTEM_SYMPTOMS, ...CUSTOM_SYMPTOMS],
  );

  // Modulo e capturas nascem desligados e sao decididos separadamente.
  const [sessionsEnabled, setSessionsEnabledState] = useState(
    initialPreferences?.sessionsEnabled ?? false,
  );
  const [sessionSetup, setSessionSetup] =
    useState<SessionSetup>(DEFAULT_SESSION_SETUP);
  const [sharing, setSharingState] = useState<SharingState>(DEFAULT_SHARING);


  const gatewayState = useSyncExternalStore(
    gateway?.subscribe ?? noopSubscribe,
    gateway?.getState ?? emptyGatewayState,
    gateway?.getState ?? emptyGatewayState,
  );
  const pendingOperations = gatewayState.operations;

  const displayed = useMemo<PersonalSlices>(
    () =>
      applyOperations(
        { checkins, sleep, journal, goals, goalProgress, cycleRecords },
        pendingOperations,
      ),
    [checkins, sleep, journal, goals, goalProgress, cycleRecords, pendingOperations],
  );
  const displayedRef = useRef(displayed);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const operation of pendingOperations) {
      ids.add(operation.entityId);
      const body = operation.request.body as Record<string, unknown>;
      if (typeof body.id === "string") ids.add(body.id);
    }
    return ids;
  }, [pendingOperations]);
  const isPendingSync = useCallback((entityId: string) => pendingIds.has(entityId), [pendingIds]);

  // ACK da fila: a resposta do servidor entra na base, fatia por fatia.
  useEffect(() => {
    if (!gateway) return;
    gateway.setReconciler((operation: OutboxOperation, body: unknown) => {
      const only = <K extends keyof BaseSlices>(key: K, prev: BaseSlices[K]) =>
        reconcileAck({ ...EMPTY_BASE, [key]: prev }, operation, body)[key];
      setCheckins((prev) => only("checkins", prev));
      setSleep((prev) => only("sleep", prev));
      setJournal((prev) => only("journal", prev));
      setGoals((prev) => only("goals", prev));
      setGoalProgress((prev) => only("goalProgress", prev));
      setCycleRecords((prev) => only("cycleRecords", prev));
      setPeriods((prev) => only("periods", prev));
    });
    return () => gateway.setReconciler(null);
  }, [gateway]);

  // Snapshot local da base (nunca do estado otimista: a fila e reaplicada).
  useEffect(() => {
    if (!gateway) return;
    const handle = setTimeout(() => {
      void gateway.saveSnapshot({
        user,
        preferences,
        checkins,
        sleep,
        factors,
        journal,
        tags,
        goals,
        goalProgress,
        cycle,
        periods,
        cycleRecords,
        symptoms,
        // A janela vai junto: offline, o aparelho precisa dizer **ate onde** tem

        window: windowInfo,
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [gateway, user, preferences, checkins, sleep, factors, journal, tags, goals, goalProgress, cycle, periods, cycleRecords, symptoms, windowInfo]);

  const offlineWrite = useCallback(
    async (spec: WriteSpec) => {
      if (!gateway) throw new Error("offline_gateway_missing");
      return gateway.write(spec);
    },
    [gateway],
  );

  const updateProfile = useCallback(async (input: ProfileUpdateInput) => {
    const saved = await requestJson<AppUser>("/api/me/profile", "PATCH", input);
    setUser(saved);
    return saved;
  }, []);

  const updatePreferences = useCallback(
    async (input: PreferencesUpdateInput) => {
      const saved = await requestJson<UserPreferences>(
        "/api/me/preferences",
        "PATCH",
        input,
      );
      setPreferences(saved);
      return saved;
    },
    [],
  );

  const addCheckin = useCallback(async (input: EmotionalCheckinInput) => {
    if (gateway) {
      const id = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.CHECKIN,
        kind: OUTBOX_KIND.CREATE,
        entityId: id,
        request: { path: "/api/emotional/checkins", method: "POST", body: { ...input, id } },
        // So na fila: online vale a hora do servidor, como na V1.
        queuedBody: { occurredAt },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const created = dataOf<EmotionalCheckin>(result.body);
        setCheckins((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        return created;
      }
      return { ...input, id, occurredAt };
    }
    const created = await requestJson<EmotionalCheckin>(
      "/api/emotional/checkins",
      "POST",
      input,
    );
    setCheckins((prev) => [created, ...prev]);
    return created;
  }, [gateway, offlineWrite]);

  const editCheckin = useCallback(
    async (input: EmotionalCheckinInput & { id: string; occurredAt?: string }) => {
      const saved = await requestJson<EmotionalCheckin>(
        "/api/emotional/checkins",
        "PATCH",
        input,
      );
      // Substitui no lugar em vez de reordenar: a data original permanece, e
      // mover a linha da lista faria a correcao parecer um registro novo.
      setCheckins((prev) =>
        prev.map((checkin) => (checkin.id === saved.id ? saved : checkin)),
      );
      return saved;
    },
    [],
  );

  const addSleep = useCallback(async (input: SleepRecordInput) => {
    if (gateway) {
      const current = displayedRef.current.sleep.find((record) => record.night === input.night);
      const baseFingerprint = current ? await fingerprint(sleepContent(current)) : null;
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.SLEEP,
        kind: current ? OUTBOX_KIND.UPDATE : OUTBOX_KIND.CREATE,
        entityId: `sleep:${input.night}`,
        coalesce: true,
        request: { path: "/api/emotional/sleep", method: "PUT", body: { ...input, baseFingerprint } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const saved = dataOf<SleepRecord>(result.body);
        setSleep((prev) => [saved, ...prev.filter((s) => s.night !== saved.night)]);
        return saved;
      }
      return { id: current?.id ?? `local-sleep-${input.night}`, ...input };
    }
    const created = await requestJson<SleepRecord>(
      "/api/emotional/sleep",
      "PUT",
      input,
    );
    setSleep((prev) => [created, ...prev.filter((s) => s.night !== input.night)]);
    return created;
  }, [gateway, offlineWrite]);

  const addCustomFactor = useCallback(async (label: string) => {
    const created = await requestJson<EmotionalFactor>(
      "/api/emotional/factors",
      "POST",
      { label },
    );
    setFactors((prev) =>
      prev.some((factor) => factor.id === created.id) ? prev : [...prev, created],
    );
    return created;
  }, []);

  const saveJournal = useCallback<MockActions["saveJournal"]>(
    async (input, options) => {
      if (gateway) {
        const id = options?.id ?? crypto.randomUUID();
        const status = options?.status ?? "saved";
        const current = displayedRef.current.journal.find((entry) => entry.id === id);
        const baseFingerprint = current ? await fingerprint(journalContent(current)) : null;
        const result = await offlineWrite({
          domain: OUTBOX_DOMAIN.JOURNAL,
          kind: current ? OUTBOX_KIND.UPDATE : OUTBOX_KIND.CREATE,
          entityId: id,
          coalesce: true,
          request: {
            path: "/api/journal/entries",
            method: "POST",
            body: { ...input, id, status, baseFingerprint },
          },
        });
        if (result.status === WRITE_STATUS.SYNCED) {
          const saved = dataOf<JournalEntry>(result.body);
          setJournal((prev) => [saved, ...prev.filter((entry) => entry.id !== saved.id)]);
          return saved;
        }
        const now = result.operation.createdAt;
        return {
          id,
          title: input.title,
          content: input.content,
          tagIds: input.tagIds,
          status,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          trashedAt: current?.trashedAt ?? null,
        };
      }
      const saved = await requestJson<JournalEntry>(
        "/api/journal/entries",
        "POST",
        { ...input, id: options?.id, status: options?.status ?? "saved" },
      );
      setJournal((prev) =>
        prev.some((entry) => entry.id === saved.id)
          ? prev.map((entry) => (entry.id === saved.id ? saved : entry))
          : [saved, ...prev],
      );
      return saved;
    },
    [gateway, offlineWrite],
  );

  const addCustomTag = useCallback(async (label: string) => {
    const created = await requestJson<JournalTag>(
      "/api/journal/tags",
      "POST",
      { label },
    );
    setTags((prev) =>
      prev.some((tag) => tag.id === created.id) ? prev : [...prev, created],
    );
    return created;
  }, []);

  const trashJournal = useCallback(async (id: string) => {
    if (gateway) {
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.JOURNAL,
        kind: OUTBOX_KIND.UPDATE,
        entityId: id,
        request: { path: "/api/journal/entries", method: "PATCH", body: { id, action: "trash" } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const updated = dataOf<JournalEntry>(result.body);
        setJournal((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
        return updated;
      }
      const current = displayedRef.current.journal.find((entry) => entry.id === id);
      return {
        ...(current as JournalEntry),
        trashedAt: result.operation.createdAt,
      };
    }
    const updated = await requestJson<JournalEntry>(
      "/api/journal/entries",
      "PATCH",
      { id, action: "trash" },
    );
    setJournal((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
    return updated;
  }, [gateway, offlineWrite]);

  const restoreJournal = useCallback(async (id: string) => {
    if (gateway) {
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.JOURNAL,
        kind: OUTBOX_KIND.UPDATE,
        entityId: id,
        request: { path: "/api/journal/entries", method: "PATCH", body: { id, action: "restore" } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const updated = dataOf<JournalEntry>(result.body);
        setJournal((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
        return updated;
      }
      const current = displayedRef.current.journal.find((entry) => entry.id === id);
      return {
        ...(current as JournalEntry),
        trashedAt: null,
      };
    }
    const updated = await requestJson<JournalEntry>(
      "/api/journal/entries",
      "PATCH",
      { id, action: "restore" },
    );
    setJournal((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
    return updated;
  }, [gateway, offlineWrite]);

  /** Exclusao permanente: acao explicita e separada da lixeira. */
  const purgeJournal = useCallback(async (id: string) => {
    if (gateway) {
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.JOURNAL,
        kind: OUTBOX_KIND.DELETE,
        entityId: id,
        request: { path: "/api/journal/entries", method: "DELETE", body: { id } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        setJournal((prev) => prev.filter((entry) => entry.id !== id));
      }
      return { id };
    }
    const deleted = await requestJson<{ id: string }>(
      "/api/journal/entries",
      "DELETE",
      { id },
    );
    setJournal((prev) => prev.filter((entry) => entry.id !== id));
    return deleted;
  }, [gateway, offlineWrite]);

  const addGoal = useCallback(async (input: GoalInput) => {
    if (gateway) {
      const id = crypto.randomUUID();
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.GOAL,
        kind: OUTBOX_KIND.CREATE,
        entityId: id,
        request: { path: "/api/goals", method: "POST", body: { ...input, id } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const created = dataOf<Goal>(result.body);
        setGoals((prev) => [created, ...prev.filter((goal) => goal.id !== created.id)]);
        return created;
      }
      return { ...input, id, status: "active", createdAt: result.operation.createdAt } satisfies Goal;
    }
    const created = await requestJson<Goal>("/api/goals", "POST", input);
    setGoals((prev) => [created, ...prev]);
    return created;
  }, [gateway, offlineWrite]);

  const setGoalStatus = useCallback(async (id: string, status: Goal["status"]) => {
    if (gateway) {
      const current = displayedRef.current.goals.find((goal) => goal.id === id);
      if (current && current.status !== status && !canTransitionGoalStatus(current.status, status)) {
        throw new Error("Transição de status não permitida.");
      }
      const baseFingerprint = current ? await fingerprint(goalStatusContent(current)) : null;
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.GOAL,
        kind: OUTBOX_KIND.UPDATE,
        entityId: id,
        coalesce: true,
        request: { path: "/api/goals", method: "PATCH", body: { id, status, baseFingerprint } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const updated = dataOf<Goal>(result.body);
        setGoals((prev) => prev.map((goal) => (goal.id === id ? updated : goal)));
        return updated;
      }
      return { ...(current as Goal), status };
    }
    const updated = await requestJson<Goal>("/api/goals", "PATCH", { id, status });
    setGoals((prev) => prev.map((goal) => (goal.id === id ? updated : goal)));
    return updated;
  }, [gateway, offlineWrite]);

  const editGoal = useCallback(
    async (input: { id: string; title: string; target: number; unit: string | null }) => {
      /*
        OFF-2 (L-408): concorrencia otimista. A base e a impressao da meta como
        esta tela a mostra (titulo, alvo, unidade, status); se outro aparelho
        mudou, o servidor responde 409 e a versao atual entra no estado — nunca
        last-write-wins. Com o gateway, a edicao vai para a fila na ordem certa
        (criada offline -> editada offline chega depois da criacao, mesmo ID).
      */
      const current = displayedRef.current.goals.find((goal) => goal.id === input.id);
      const baseFingerprint = current ? await fingerprint(goalEditContent(current)) : null;
      const body = { ...input, baseFingerprint };
      try {
        if (gateway) {
          const result = await offlineWrite({
            domain: OUTBOX_DOMAIN.GOAL,
            kind: OUTBOX_KIND.UPDATE,
            entityId: input.id,
            coalesce: true,
            request: { path: "/api/goals", method: "PUT", body },
          });
          if (result.status === WRITE_STATUS.SYNCED) {
            const updated = dataOf<Goal>(result.body);
            setGoals((prev) => prev.map((goal) => (goal.id === input.id ? updated : goal)));
            return updated;
          }
          return { ...(current as Goal), title: input.title, target: input.target, unit: input.unit };
        }
        const updated = await requestJson<Goal>("/api/goals", "PUT", body);
        setGoals((prev) => prev.map((goal) => (goal.id === input.id ? updated : goal)));
        return updated;
      } catch (error) {
        if (error instanceof OnlineWriteError && error.status === 409) {
          const latest = (error.conflict ?? null) as Goal | null;
          // Removida em outro aparelho: o cartao fica ate recarregar, para a
          // pessoa ler o aviso no proprio formulario.
          if (latest) setGoals((prev) => prev.map((goal) => (goal.id === input.id ? latest : goal)));
          throw new GoalEditConflictError(latest);
        }
        throw error;
      }
    },
    [gateway, offlineWrite],
  );

  const addGoalProgress = useCallback(async (goalId: string, amount: number) => {
    if (gateway) {
      const goal = displayedRef.current.goals.find((item) => item.id === goalId);
      if (goal && goal.status !== "active") {
        throw new Error("Somente metas ativas recebem progresso.");
      }
      const id = crypto.randomUUID();
      const day = toDay(new Date());
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.GOAL_PROGRESS,
        kind: OUTBOX_KIND.CREATE,
        entityId: id,
        dependsOn: goalId,
        request: { path: "/api/goals/progress", method: "POST", body: { goalId, amount, id } },
        // So na fila: o dia em que a pessoa registrou, e nao o dia do sync.
        queuedBody: { day },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const created = dataOf<GoalProgressEntry>(result.body);
        setGoalProgress((prev) => [...prev.filter((entry) => entry.id !== created.id), created]);
        return created;
      }
      return { id, goalId, amount, day };
    }
    const created = await requestJson<GoalProgressEntry>(
      "/api/goals/progress",
      "POST",
      { goalId, amount },
    );
    setGoalProgress((prev) => [...prev, created]);
    return created;
  }, [gateway, offlineWrite]);

  const enableCycle = useCallback(async () => {
    const saved = await requestJson<CycleProfile>("/api/cycle/profile", "PATCH", {
      enabled: true,
    });
    setCycle(saved);
    return saved;
  }, []);

  /**
   * Desativar **nao** apaga. O usuario que desliga o modulo continua dono dos
   * seus registros e pode reativar sem perder historico.
   */
  const disableCycle = useCallback(async () => {
    const saved = await requestJson<CycleProfile>("/api/cycle/profile", "PATCH", {
      enabled: false,
    });
    setCycle(saved);
    return saved;
  }, []);

  /** Exclusao de dados: fluxo proprio, explicito e irreversivel. */
  const deleteCycleData = useCallback(async () => {
    const deleted = await requestJson<{ deleted: unknown }>(
      "/api/cycle/data",
      "DELETE",
      {},
    );
    setPeriods([]);
    setCycleRecords([]);
    setSymptoms((prev) => prev.filter((symptom) => symptom.origin === "system"));
    return deleted;
  }, []);

  const saveCycleRecord = useCallback(async (input: CycleDailyRecordInput) => {
    if (gateway) {
      const current = displayedRef.current.cycleRecords.find((record) => record.date === input.date);
      const baseFingerprint = current ? await fingerprint(cycleRecordContent(current)) : null;
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.CYCLE_RECORD,
        kind: current ? OUTBOX_KIND.UPDATE : OUTBOX_KIND.CREATE,
        entityId: `cycle:${input.date}`,
        coalesce: true,
        request: { path: "/api/cycle/records", method: "POST", body: { ...input, baseFingerprint } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        const saved = dataOf<{ record: CycleDailyRecord; periods: CyclePeriod[] }>(result.body);
        setCycleRecords((prev) => [
          ...prev.filter((record) => record.date !== saved.record.date),
          saved.record,
        ]);
        setPeriods(saved.periods);
        return saved.record;
      }
      return { id: current?.id ?? `local-cycle-${input.date}`, ...input };
    }
    const saved = await requestJson<{
      record: CycleDailyRecord;
      periods: CyclePeriod[];
    }>(
      "/api/cycle/records",
      "POST",
      input,
    );
    setCycleRecords((prev) =>
      prev.some((record) => record.id === saved.record.id)
        ? prev.map((record) =>
            record.id === saved.record.id ? saved.record : record,
          )
        : [
            ...prev.filter((record) => record.date !== saved.record.date),
            saved.record,
          ],
    );
    setPeriods(saved.periods);
    return saved.record;
  }, [gateway, offlineWrite]);

  const deleteCycleRecord = useCallback(async (date: string) => {
    if (gateway) {
      const current = displayedRef.current.cycleRecords.find((record) => record.date === date);
      const result = await offlineWrite({
        domain: OUTBOX_DOMAIN.CYCLE_RECORD,
        kind: OUTBOX_KIND.DELETE,
        entityId: `cycle:${date}`,
        request: { path: "/api/cycle/records", method: "DELETE", body: { date } },
      });
      if (result.status === WRITE_STATUS.SYNCED) {
        setCycleRecords((prev) => prev.filter((r) => r.date !== date));
      }
      return { id: current?.id ?? "", date };
    }
    const deleted = await requestJson<{ id: string; date: string }>(
      "/api/cycle/records",
      "DELETE",
      { date },
    );
    setCycleRecords((prev) => prev.filter((r) => r.date !== date));
    return deleted;
  }, [gateway, offlineWrite]);

  const addCustomSymptom = useCallback(async (label: string) => {
    const created = await requestJson<CycleSymptom>(
      "/api/cycle/symptoms",
      "POST",
      { label },
    );
    setSymptoms((prev) =>
      prev.some((symptom) => symptom.id === created.id)
        ? prev
        : [...prev, created],
    );
    return created;
  }, []);

  /**
   * Desligar o modulo revoga as permissoes de captura e de compartilhamento.
   *
   * Liga-lo de volta **nao** as restaura: o consentimento e reconstruido no
   * preflight. Guardar a escolha anterior faria a reativacao conceder acesso a
   * camera sem que ninguem tenha autorizado de novo.
   */
  const setSessionsEnabled = useCallback(async (on: boolean) => {
    const saved = await requestJson<UserPreferences>(
      "/api/me/preferences",
      "PATCH",
      { sessionsEnabled: on },
    );
    setPreferences(saved);
    setSessionsEnabledState(saved.sessionsEnabled);
    if (!saved.sessionsEnabled) setSessionSetup(DEFAULT_SESSION_SETUP);
  }, []);

  const resetSessionSetup = useCallback(() => {
    setSessionSetup(DEFAULT_SESSION_SETUP);
  }, []);

  const updateSessionSetup = useCallback((patch: Partial<SessionSetup>) => {
    setSessionSetup((prev) => ({ ...prev, ...patch }));
  }, []);

  const setSharing = useCallback(
    (category: ShareableCategory, on: boolean) => {
      setSharingState((prev) => ({ ...prev, [category]: on }));
    },
    [],
  );


  const loadOlderHistory = useCallback(
    async (domains: readonly HistoryDomain[]) => {
      const base = displayedRef.current;
      const cursorFor = (domain: HistoryDomain): string => {
        switch (domain) {
          case HISTORY_DOMAIN.CHECKINS:
            return base.checkins.reduce(
              (oldest, item) => (item.occurredAt < oldest ? item.occurredAt : oldest),
              windowInfo.since,
            );
          case HISTORY_DOMAIN.JOURNAL:
            return base.journal.reduce(
              (oldest, item) => (item.updatedAt < oldest ? item.updatedAt : oldest),
              windowInfo.since,
            );
          case HISTORY_DOMAIN.SLEEP:
            return base.sleep.reduce(
              (oldest, item) => (item.night < oldest ? item.night : oldest),
              windowInfo.since,
            );
          case HISTORY_DOMAIN.CYCLE_RECORDS:
            return base.cycleRecords.reduce(
              (oldest, item) => (item.date < oldest ? item.date : oldest),
              windowInfo.since,
            );
          default:
            return base.goalProgress.reduce(
              (oldest, item) => (item.day < oldest ? item.day : oldest),
              windowInfo.since,
            );
        }
      };

      setLoadingOlder(true);
      let loaded = 0;
      try {
        for (const domain of domains) {
          if (windowInfo.olderCounts[domain] <= 0) continue;
          const response = await fetch(
            `/api/personal/history?domain=${domain}&before=${encodeURIComponent(cursorFor(domain))}`,
            { headers: { accept: "application/json" }, credentials: "same-origin" },
          ).catch(() => null);
          if (!response?.ok) throw new NetworkUnavailableError("/api/personal/history");
          const payload = (await response.json()) as {
            data?: { items?: unknown[] };
          };
          const items = payload.data?.items ?? [];
          loaded += items.length;
          const merge = <T extends { id: string }>(previous: T[], incoming: unknown[]) => {
            const known = new Set(previous.map((item) => item.id));
            const fresh = (incoming as T[]).filter((item) => !known.has(item.id));
            return fresh.length === 0 ? previous : [...previous, ...fresh];
          };
          if (domain === HISTORY_DOMAIN.CHECKINS) setCheckins((prev) => merge(prev, items));
          if (domain === HISTORY_DOMAIN.JOURNAL) setJournal((prev) => merge(prev, items));
          if (domain === HISTORY_DOMAIN.SLEEP) setSleep((prev) => merge(prev, items));
          if (domain === HISTORY_DOMAIN.CYCLE_RECORDS) {
            setCycleRecords((prev) => merge(prev, items));
          }
          if (domain === HISTORY_DOMAIN.GOAL_PROGRESS) {
            setGoalProgress((prev) => merge(prev, items));
          }
          setWindowInfo((prev) => {
            const olderCounts = {
              ...prev.olderCounts,
              [domain]: Math.max(0, prev.olderCounts[domain] - items.length),
            };
            return {
              ...prev,
              olderCounts,
              hasOlder: Object.values(olderCounts).some((count) => count > 0),
            };
          });
        }
      } finally {
        setLoadingOlder(false);
      }
      return loaded;
    },
    [windowInfo],
  );

  const value = useMemo<MockStore>(
    () => ({
      user,
      preferences,
      checkins: displayed.checkins,
      sleep: displayed.sleep,
      factors,
      journal: displayed.journal,
      tags,
      goals: displayed.goals,
      goalProgress: displayed.goalProgress,
      cycle,
      periods,
      cycleRecords: displayed.cycleRecords,
      symptoms,
      window: windowInfo,
      loadingOlder,
      sessionsEnabled,
      sessionSetup,
      sharing,
      isPendingSync,
      offlineMode: gateway ? gateway.mode : null,
      loadOlderHistory,
      updateProfile,
      updatePreferences,
      addCheckin,
      editCheckin,
      addSleep,
      addCustomFactor,
      saveJournal,
      addCustomTag,
      trashJournal,
      restoreJournal,
      purgeJournal,
      addGoal,
      setGoalStatus,
      editGoal,
      addGoalProgress,
      enableCycle,
      disableCycle,
      deleteCycleData,
      saveCycleRecord,
      deleteCycleRecord,
      addCustomSymptom,
      setSessionsEnabled,
      updateSessionSetup,
      resetSessionSetup,
      setSharing,
    }),
    [
      user,
      preferences,
      displayed,
      factors,
      tags,
      cycle,
      periods,
      symptoms,
      windowInfo,
      loadingOlder,
      loadOlderHistory,
      sessionsEnabled,
      sessionSetup,
      sharing,
      isPendingSync,
      gateway,
      updateProfile,
      updatePreferences,
      addCheckin,
      editCheckin,
      addSleep,
      addCustomFactor,
      saveJournal,
      addCustomTag,
      trashJournal,
      restoreJournal,
      purgeJournal,
      addGoal,
      setGoalStatus,
      editGoal,
      addGoalProgress,
      enableCycle,
      disableCycle,
      deleteCycleData,
      saveCycleRecord,
      deleteCycleRecord,
      addCustomSymptom,
      setSessionsEnabled,
      updateSessionSetup,
      resetSessionSetup,
      setSharing,
    ],
  );

  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
}

export function useMockStore(): MockStore {
  const ctx = useContext(MockContext);
  if (!ctx) {
    throw new Error("useMockStore precisa estar dentro de <MockProvider>.");
  }
  return ctx;
}
