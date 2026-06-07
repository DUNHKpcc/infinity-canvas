import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

const latestVersionUrl = "https://raw.githubusercontent.com/DUNHKpcc/infinity-canvas/main/VERSION";
const latestChangelogUrl = "https://raw.githubusercontent.com/DUNHKpcc/infinity-canvas/main/CHANGELOG.md";

function readLocalReleases(): ReleaseInfo[] {
    try {
        return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
    } catch {
        return [];
    }
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

// Keep whichever version is newer, so a remote that lags behind the local build never shows as "latest".
function pickNewerVersion(a: string, b: string) {
    return isNewerVersion(b, a) ? b : a;
}

function compareVersionDesc(a: string, b: string) {
    const pa = toVersionParts(a);
    const pb = toVersionParts(b);
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    for (let index = 0; index < 3; index++) {
        if (pa[index] !== pb[index]) return pb[index] - pa[index];
    }
    return 0;
}

// Union of local (this build) and remote releases, deduped by version (local wins), newest first.
// Prevents the timeline from regressing when remote lags behind the local CHANGELOG.
function mergeReleases(local: ReleaseInfo[], remote: ReleaseInfo[]): ReleaseInfo[] {
    const seen = new Set<string>();
    const merged: ReleaseInfo[] = [];
    for (const release of [...local, ...remote]) {
        if (seen.has(release.version)) continue;
        seen.add(release.version);
        merged.push(release);
    }
    return merged.sort((a, b) => compareVersionDesc(a.version, b.version));
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) return false;
            const version = await response.text();
            setLatestVersion(pickNewerVersion(currentVersion, version.trim() || currentVersion));
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error("版本读取失败");
                if (!changelogResponse.ok) throw new Error("更新日志读取失败");
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(pickNewerVersion(currentVersion, version.trim() || currentVersion));
                setReleases(changelog.trim() ? mergeReleases(localReleases, parseChangelog(changelog)) : localReleases);
                if (showMessage) message.success("已获取最新版本信息");
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error("获取最新版本信息失败");
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
