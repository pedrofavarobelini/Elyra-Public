

/** Prompts exibidos durante a sessao, por tipo. */
export const SESSION_PROMPT: Record<string, { title: string; body: string }> = {
  guided: {
    title: "Como foi seu dia?",
    body: "Fale sobre seus sentimentos, pensamentos e experiências de hoje.",
  },
  free: {
    title: "O espaço é seu",
    body: "Fale sobre o que quiser, no seu tempo. Não há resposta certa.",
  },
  deep_checkin: {
    title: "Vamos com calma",
    body: "Comece contando como você está se sentindo agora, no corpo e na cabeça.",
  },
};

export const SESSION_TIPS = [
  {
    title: "Fale com naturalidade",
    body: "Não se preocupe com respostas certas ou erradas.",
  },
  {
    title: "Ambiente tranquilo",
    body: "Escolha um local silencioso para uma melhor experiência.",
  },
  {
    title: "Seja você mesmo",
    body: "Compartilhe no seu tempo. Estamos aqui para te ouvir.",
  },
] as const;
