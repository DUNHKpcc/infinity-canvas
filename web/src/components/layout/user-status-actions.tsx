"use client";

import { useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Avatar, Dropdown, Tooltip } from "antd";
import { BookOpen, Keyboard, LogOut, Monitor, Moon, Settings2, Shield, Sun, User } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import Link from "next/link";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { UserDetailModal } from "@/components/layout/user-detail-modal";
import { CreditSymbol } from "@/constant/credits";
import { DOCS_URL } from "@/constant/env";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { getSystemTheme, useThemeStore, type ThemeName, type ThemePreference } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountOpen, onAccountOpenChange, accountRef, getPopupContainer }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const preference = useThemeStore((state) => state.preference);
    const setPreference = useThemeStore((state) => state.setPreference);
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [detailOpen, setDetailOpen] = useState(false);
    const canvasTheme = canvasThemes[theme];
    const userName = user?.displayName || user?.username || "";
    const credits = user?.credits ?? 0;
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;
    const menuItems: ItemType[] = [
        { key: "user", disabled: true, label: <span className="font-medium text-current">{userName}</span> },
        { key: "detail", icon: <User className="size-4" />, label: "用户详情", onClick: () => setDetailOpen(true) },
        ...(user?.role === "admin" ? [{ key: "admin", icon: <Shield className="size-4" />, label: <Link href="/admin">管理后台</Link> }] : []),
        ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: "快捷键", onClick: onOpenShortcuts }] : []),
        { type: "divider" },
        { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: logout },
    ];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档" title="文档">
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <ThemePreferenceToggle preference={preference} theme={theme} onSelect={setPreference} style={iconStyle} />
            <VersionReleaseModal style={versionStyle} />
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
            {variant === "canvas" && user ? (
                <Tooltip title="当前算力点余额" placement="bottom">
                    <div className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium tabular-nums opacity-75 transition hover:opacity-100" style={{ color: canvasTheme.node.text }}>
                        <CreditSymbol className="text-sm leading-none" />
                        <span>{credits.toLocaleString()}</span>
                    </div>
                </Tooltip>
            ) : null}
            {!user && onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {!user ? (
                <Link href="/login" className="px-1.5 text-sm font-medium text-stone-600 underline-offset-4 transition hover:text-stone-950 hover:underline dark:text-stone-300 dark:hover:text-stone-100" style={iconStyle}>
                    登录
                </Link>
            ) : null}
            {user ? (
                <div ref={accountRef}>
                    <Dropdown open={accountOpen} onOpenChange={onAccountOpenChange} trigger={["click"]} placement="bottomRight" getPopupContainer={getPopupContainer} styles={{ root: { minWidth: 150 } }} menu={{ items: menuItems }}>
                        <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label="账户菜单">
                            <Avatar
                                size={24}
                                src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}
                                alt={userName}
                                className="!flex !items-center !justify-center border border-stone-300 bg-transparent text-[11px] font-semibold text-stone-800 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400 dark:hover:text-white"
                                style={avatarStyle}
                            >
                                {avatarText}
                            </Avatar>
                        </button>
                    </Dropdown>
                    <UserDetailModal open={detailOpen} onClose={() => setDetailOpen(false)} />
                </div>
            ) : null}
        </div>
    );
}

const THEME_PREFERENCE_OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
    { value: "light", label: "浅色", icon: <Sun className="size-4" /> },
    { value: "system", label: "跟随系统", icon: <Monitor className="size-4" /> },
    { value: "dark", label: "深色", icon: <Moon className="size-4" /> },
];

function ThemePreferenceToggle({ preference, theme, onSelect, style }: { preference: ThemePreference; theme: ThemeName; onSelect: (preference: ThemePreference) => void; style?: CSSProperties }) {
    return (
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.06] p-0.5 dark:bg-white/10" style={style} role="radiogroup" aria-label="主题模式">
            {THEME_PREFERENCE_OPTIONS.map((option) => {
                const active = preference === option.value;
                const targetTheme: ThemeName = option.value === "system" ? getSystemTheme() : option.value;
                return (
                    <AnimatedThemeToggler
                        key={option.value}
                        theme={theme}
                        targetTheme={targetTheme}
                        onThemeChange={() => onSelect(option.value)}
                        className={cn(
                            "inline-flex size-7 items-center justify-center rounded-full transition [&_svg]:size-4",
                            active ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100",
                        )}
                        role="radio"
                        aria-checked={active}
                        aria-label={option.label}
                        title={option.label}
                    >
                        {option.icon}
                    </AnimatedThemeToggler>
                );
            })}
        </div>
    );
}
