"use client";

/**
 * Cloud auth hook — STUBBED for the internal-use fork.
 *
 * Several existing components (`profile-data-table.tsx`,
 * `profile-sync-dialog.tsx`, `settings-dialog.tsx`,
 * `sync-config-dialog.tsx`) read the cloud user to decide whether to
 * render upgrade prompts / Pro badges / locked-feature UI.
 *
 * In this fork there is no cloud control plane (cloud_auth.rs is a
 * stub), so the hook always reports "not logged in / no user / not
 * loading". Every consumer falls through to the self-hosted code path
 * unchanged, and any Pro-feature gate that's gated on
 * `cloudUser?.plan !== "free"` ends up evaluating "unlock".
 *
 * Returning the same shape the original hook returned keeps every call
 * site working without edits — they just see a permanently-anonymous
 * state.
 */
export interface CloudUser {
  id: string;
  email: string;
  plan: string;
  planPeriod?: string | null;
  subscriptionStatus: string;
  profileLimit: number;
  cloudProfilesUsed: number;
  proxyBandwidthLimitMb: number;
  proxyBandwidthUsedMb: number;
  proxyBandwidthExtraMb: number;
  teamId?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
}

export interface CloudAuthState {
  user: CloudUser;
  logged_in_at: string;
}

interface UseCloudAuthReturn {
  user: CloudUser | null;
  authState: CloudAuthState | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useCloudAuth(): UseCloudAuthReturn {
  return {
    user: null,
    authState: null,
    isLoading: false,
    isLoggedIn: false,
    refresh: async () => {},
    logout: async () => {},
  };
}
