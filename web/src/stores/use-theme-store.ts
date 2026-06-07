import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";
export type ThemePreference = "light" | "dark" | "system";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function getSystemTheme(): ThemeName {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ThemeName {
    return preference === "system" ? getSystemTheme() : preference;
}

type ThemeStore = {
    /** Resolved theme, always "light" or "dark". This is what UI consumes. */
    theme: ThemeName;
    /** User preference, may be "system". This is what is persisted. */
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => void;
    setTheme: (theme: ThemeName) => void;
    /** Re-resolve from the OS when preference is "system" (call on prefers-color-scheme change). */
    syncSystemTheme: () => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            theme: "dark",
            preference: "dark",
            setPreference: (preference) => set({ preference, theme: resolveTheme(preference) }),
            setTheme: (theme) => set({ preference: theme, theme }),
            syncSystemTheme: () => {
                if (get().preference === "system") set({ theme: getSystemTheme() });
            },
        }),
        {
            name: "infinite-canvas:theme_store",
            partialize: (state) => ({ preference: state.preference }),
            merge: (persisted, current) => {
                const stored = persisted as { preference?: ThemePreference; theme?: ThemeName } | undefined;
                // Migrate pre-existing data that only stored `theme`.
                const preference = stored?.preference ?? stored?.theme ?? current.preference;
                return { ...current, preference, theme: resolveTheme(preference) };
            },
        },
    ),
);
