/**
 * Auth State Manager — Supabase Auth Edition
 *
 * Uses chrome.identity.launchWebAuthFlow to get a Google ID token,
 * then passes it to supabase.auth.signInWithIdToken() for server-side
 * session management per Supabase Chrome Extension docs.
 *
 * Request counting (3 free tier) still uses chrome.storage.local.
 */

import { supabase } from "./supabaseClient";
import type { User as SupabaseUser } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

// ── Constants ──────────────────────────────────────────────────────

export const FREE_REQUEST_LIMIT = 3;

const STORAGE_KEY_REQUEST_COUNT = "__pc_request_count";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// ── Request Counting (daily, persists across sign-out) ─────────────

/** Returns today's date string in YYYY-MM-DD format */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // e.g. "2026-02-25"
}

export async function getRequestCount(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_REQUEST_COUNT);
    const data = result[STORAGE_KEY_REQUEST_COUNT];
    if (!data || data.date !== todayKey()) {
      // New day or no data — count is 0
      return 0;
    }
    return data.count || 0;
  } catch {
    return 0;
  }
}

export async function incrementRequestCount(): Promise<number> {
  const today = todayKey();
  const current = await getRequestCount();
  const newCount = current + 1;
  await chrome.storage.local.set({
    [STORAGE_KEY_REQUEST_COUNT]: { count: newCount, date: today },
  });
  return newCount;
}

export async function canMakeRequest(): Promise<boolean> {
  const user = await getUser();
  if (user) return true;
  const count = await getRequestCount();
  return count < FREE_REQUEST_LIMIT;
}

// ── User Profile (Supabase) ────────────────────────────────────────

function mapSupabaseUser(su: SupabaseUser): User {
  const meta = su.user_metadata || {};
  // Also check identity_data from the Google identity provider
  const identity = su.identities?.find((i) => i.provider === "google");
  const idData = identity?.identity_data || {};

  // Try multiple sources for each field (Supabase stores Google data variably)
  const name =
    meta.full_name ||
    meta.name ||
    idData.full_name ||
    idData.name ||
    meta.preferred_username ||
    su.email?.split("@")[0] ||
    "User";
  const email = su.email || meta.email || idData.email || "";
  const avatar =
    meta.avatar_url ||
    meta.picture ||
    idData.avatar_url ||
    idData.picture ||
    "";

  return { id: su.id, name, email, avatar };
}

/**
 * Get the current user from Supabase session.
 */
export async function getUser(): Promise<User | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      return mapSupabaseUser(session.user);
    }
  } catch (e) {
    console.warn("Failed to get user session:", e);
  }
  return null;
}

/**
 * Sign out from Supabase.
 * Note: free request count is NOT reset — it resets daily at midnight.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ── Google OAuth via chrome.identity + Supabase ────────────────────

/**
 * Launch Google OAuth flow, get ID token, sign in with Supabase.
 *
 * Per Supabase docs for Chrome Extensions:
 * 1. chrome.identity.launchWebAuthFlow → Google consent → ID token
 * 2. supabase.auth.signInWithIdToken({ provider: 'google', token })
 */
export async function signInWithGoogle(): Promise<User> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Google Client ID not configured. Check VITE_GOOGLE_CLIENT_ID in .env",
    );
  }

  const redirectUrl = chrome.identity.getRedirectURL();

  // Generate nonce for extra security
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
  const encoder = new TextEncoder();
  const encodedNonce = encoder.encode(nonce);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encodedNonce);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashedNonce = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("nonce", hashedNonce);
  authUrl.searchParams.set("prompt", "select_account");

  // Launch the OAuth popup
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error("Authentication was cancelled");
  }

  // Extract ID token from the redirect URL hash
  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.hash.substring(1));
  const idToken = params.get("id_token");

  if (!idToken) {
    throw new Error("No ID token received from Google");
  }

  // Sign in with Supabase using the ID token
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: nonce,
  });

  if (error) {
    throw new Error(`Supabase sign-in failed: ${error.message}`);
  }

  if (!data.user) {
    throw new Error("No user returned from Supabase");
  }

  return mapSupabaseUser(data.user);
}

// ── Auth State Listener ────────────────────────────────────────────

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(callback: (user: User | null) => void) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      callback(mapSupabaseUser(session.user));
    } else {
      callback(null);
    }
  });
  return () => subscription.unsubscribe();
}
