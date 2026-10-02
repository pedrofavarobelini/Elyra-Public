import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Informe seu nome.")
  .max(80, "O nome pode ter no máximo 80 caracteres.");

export const profileUpdateSchema = z.object({ displayName: displayNameSchema });
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;


export const PRIMARY_GOALS = [
  "routine",
  "mood_understanding",
  "sleep",
  "wellbeing",
  "healthy_habits",
  "cycle_tracking",
  "self_knowledge",
  "other",
] as const;
export const primaryGoalSchema = z.enum(PRIMARY_GOALS, {
  message: "Escolha um dos objetivos da lista.",
});
export type PrimaryGoal = z.infer<typeof primaryGoalSchema>;

export const PRIMARY_GOAL_LABEL: Record<PrimaryGoal, string> = {
  routine: "Melhorar minha rotina",
  mood_understanding: "Entender melhor meu humor",
  sleep: "Dormir melhor",
  wellbeing: "Cuidar do meu bem-estar",
  healthy_habits: "Criar hábitos mais saudáveis",
  cycle_tracking: "Acompanhar meu ciclo",
  self_knowledge: "Autoconhecimento",
  other: "Outro",
};

export function isPrimaryGoal(value: unknown): value is PrimaryGoal {
  return primaryGoalSchema.safeParse(value).success;
}

export const preferencesUpdateSchema = z
  .object({
    checkinReminder: z.boolean().optional(),
    goalReminder: z.boolean().optional(),
    sessionsEnabled: z.boolean().optional(),
    primaryGoal: primaryGoalSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.checkinReminder !== undefined ||
      value.goalReminder !== undefined ||
      value.sessionsEnabled !== undefined ||
      value.primaryGoal !== undefined,
    "Informe pelo menos uma preferência.",
  );
export type PreferencesUpdateInput = z.infer<typeof preferencesUpdateSchema>;

export interface AppUser {
  id: string;
  name: string;
  initials: string;
  email: string;
}

export interface UserPreferences {
  checkinReminder: boolean;
  goalReminder: boolean;
  sessionsEnabled: boolean;
  primaryGoal: PrimaryGoal | null;
}

export interface IdentitySnapshot {
  user: AppUser;
  preferences: UserPreferences;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("");
}
