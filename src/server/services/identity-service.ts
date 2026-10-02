import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  initialsFromName,
  isPrimaryGoal,
  preferencesUpdateSchema,
  profileUpdateSchema,
  type IdentitySnapshot,
} from "@/lib/contracts/identity";
import type { Database } from "@/lib/supabase/database.types";
import {
  appendAudit,
  findPreferences,
  findProfile,
  savePreferences,
  saveProfile,
} from "@/server/repositories/identity-repository";

type Client = SupabaseClient<Database>;

export async function getIdentitySnapshot(
  client: Client,
  user: User,
): Promise<IdentitySnapshot> {
  const [profile, preferences] = await Promise.all([
    findProfile(client, user.id),
    findPreferences(client, user.id),
  ]);
  const name = profile.display_name;
  return {
    user: {
      id: user.id,
      name,
      initials: initialsFromName(name),
      email: user.email ?? "",
    },
    preferences: {
      checkinReminder: preferences.checkin_reminder,
      goalReminder: preferences.goal_reminder,
      sessionsEnabled: preferences.sessions_enabled,
      primaryGoal: isPrimaryGoal(preferences.primary_goal)
        ? preferences.primary_goal
        : null,
    },
  };
}

export async function updateProfile(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = profileUpdateSchema.parse(rawInput);
  const profile = await saveProfile(client, user.id, input.displayName);
  await appendAudit(client, {
    actorUserId: user.id,
    action: "profile.updated",
    entityType: "profile",
    entityId: user.id,
    correlationId: crypto.randomUUID(),
  });
  return {
    id: user.id,
    name: profile.display_name,
    initials: initialsFromName(profile.display_name),
    email: user.email ?? "",
  };
}

export async function updatePreferences(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = preferencesUpdateSchema.parse(rawInput);
  const saved = await savePreferences(client, user.id, {
    ...(input.checkinReminder === undefined
      ? {}
      : { checkin_reminder: input.checkinReminder }),
    ...(input.goalReminder === undefined
      ? {}
      : { goal_reminder: input.goalReminder }),
    ...(input.sessionsEnabled === undefined
      ? {}
      : { sessions_enabled: input.sessionsEnabled }),
    ...(input.primaryGoal === undefined
      ? {}
      : { primary_goal: input.primaryGoal }),
  });
  await appendAudit(client, {
    actorUserId: user.id,
    action: "preferences.updated",
    entityType: "user_preferences",
    entityId: user.id,
    correlationId: crypto.randomUUID(),
  });
  return {
    checkinReminder: saved.checkin_reminder,
    goalReminder: saved.goal_reminder,
    sessionsEnabled: saved.sessions_enabled,
    primaryGoal: isPrimaryGoal(saved.primary_goal) ? saved.primary_goal : null,
  };
}
