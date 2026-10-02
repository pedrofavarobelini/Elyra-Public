
export type SettingsContext = "personal" | "professional";

export interface SettingsPaths {
  hub: string;
  /** Nome e foto da conta. Mora no Perfil pessoal (a conta e uma so). */
  identity: string;
  security: string;
  notifications: string;
  data: string;
  personalization: string;
}

export const SETTINGS_PATHS: Record<SettingsContext, SettingsPaths> = {
  personal: {
    hub: "/configuracoes",
    identity: "/perfil",
    security: "/seguranca",
    notifications: "/notificacoes",
    data: "/configuracoes/dados",
    personalization: "/configuracoes/personalizacao",
  },
  professional: {
    hub: "/pro/configuracoes",
    identity: "/perfil",
    security: "/pro/configuracoes/seguranca",
    notifications: "/pro/configuracoes/notificacoes",
    data: "/pro/configuracoes/dados",
    personalization: "/pro/configuracoes/personalizacao",
  },
};

export function settingsPaths(context: SettingsContext): SettingsPaths {
  return SETTINGS_PATHS[context];
}
