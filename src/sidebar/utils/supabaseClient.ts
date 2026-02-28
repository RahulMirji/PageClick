import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Chrome extensions can't use localStorage reliably across contexts
    // Use custom storage backed by chrome.storage.local
    storage: {
      getItem: async (key: string) => {
        const result = await chrome.storage.local.get(key);
        return result[key] ?? null;
      },
      setItem: async (key: string, value: string) => {
        await chrome.storage.local.set({ [key]: value });
      },
      removeItem: async (key: string) => {
        await chrome.storage.local.remove(key);
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
