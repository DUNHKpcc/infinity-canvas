"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { App, Avatar, Modal } from "antd";
import { Camera, LoaderCircle } from "lucide-react";

import { CreditSymbol } from "@/constant/credits";
import { compressImageToWebp } from "@/lib/image-utils";
import { uploadAvatar } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

const ROLE_LABELS: Record<string, string> = { admin: "管理员", user: "用户", guest: "访客" };

export function UserDetailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const setUser = useUserStore((state) => state.setUser);
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    if (!user) return null;

    const userName = user.displayName || user.username || "";
    const avatarUrl = user.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();

    const onPick = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return;
        }
        void (async () => {
            setUploading(true);
            try {
                const webp = await compressImageToWebp(file, { size: 256, quality: 0.85 });
                const updated = await uploadAvatar(webp, token);
                setUser(updated);
                message.success("头像已更新");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "头像更新失败");
            } finally {
                setUploading(false);
            }
        })();
    };

    return (
        <Modal title="用户详情" open={open} onCancel={onClose} footer={null} centered width={420}>
            <div className="flex flex-col items-center gap-2 pb-2 pt-1">
                <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="group relative size-24 overflow-hidden rounded-full disabled:cursor-not-allowed" aria-label="更换头像">
                    <Avatar size={96} src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined} className="!flex !size-24 !items-center !justify-center !text-2xl !font-semibold">
                        {avatarText}
                    </Avatar>
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100" style={uploading ? { opacity: 1 } : undefined}>
                        {uploading ? <LoaderCircle className="size-6 animate-spin" /> : <Camera className="size-6" />}
                    </span>
                </button>
                <div className="text-xs text-stone-400">点击头像更换，自动压缩为 webp</div>
            </div>

            <dl className="mt-2 divide-y divide-stone-100 text-sm dark:divide-stone-800">
                <DetailRow label="用户名" value={user.username} />
                {user.displayName ? <DetailRow label="昵称" value={user.displayName} /> : null}
                <DetailRow label="角色" value={ROLE_LABELS[user.role] || user.role} />
                <DetailRow
                    label="算力点"
                    value={
                        <span className="inline-flex items-center gap-1 tabular-nums">
                            <CreditSymbol />
                            {user.credits.toLocaleString()}
                        </span>
                    }
                />
                {user.createdAt ? <DetailRow label="注册时间" value={formatDate(user.createdAt)} /> : null}
            </dl>

            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        </Modal>
    );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="shrink-0 text-stone-400">{label}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
        </div>
    );
}

function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
