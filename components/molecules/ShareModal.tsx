// components/molecules/ShareModal.tsx
// ─────────────────────────────────────
// Molecule: Document sharing management modal.
// Lets the document owner grant/revoke access for other simulated users.

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, UserPlus, Trash2, Crown, Share2 } from "lucide-react";
import Button from "@/components/atoms/Button";
import Badge from "@/components/atoms/Badge";
import Avatar from "@/components/atoms/Avatar";
import Spinner from "@/components/atoms/Spinner";
import { useToast } from "@/components/atoms/ToastProvider";
import { USER_PROFILES, SHARE_PERMISSIONS, type SharePermission } from "@/lib/constants";

interface Share {
  id: string;
  userId: string;
  permission: "view" | "edit";
}

interface ShareModalProps {
  documentId: string;
  documentTitle: string;
  ownerName: string;           // name string of the owning user
  activeUser: { id: string; name: string; avatar: string; color: string };
  onClose: () => void;
}

export default function ShareModal({
  documentId,
  documentTitle,
  ownerName,
  activeUser,
  onClose,
}: ShareModalProps) {
  const { addToast } = useToast();

  const [shares, setShares]       = useState<Share[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving]   = useState(false);

  // Per-user pending grant permission
  const [selectedPermission, setSelectedPermission] = useState<SharePermission>(
    SHARE_PERMISSIONS.VIEW
  );

  const isOwner = activeUser.name === ownerName;

  // ── Fetch existing shares ───────────────────────────────────────────────────
  const fetchShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/shares`);
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Unknown error" }));
        addToast("error", `Failed to load shares: ${error}`);
        return;
      }
      const data = await res.json();
      setShares(data);
    } catch {
      addToast("error", "Network error — could not load shares.");
    } finally {
      setIsLoading(false);
    }
  }, [documentId, addToast]);

  useEffect(() => { fetchShares(); }, [fetchShares]);

  // ── Grant access ────────────────────────────────────────────────────────────
  const handleGrant = async (userId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, permission: selectedPermission }),
      });
      const body = await res.json();
      if (!res.ok) {
        addToast("error", body.error ?? "Failed to share document.");
        return;
      }
      addToast("success", "Access granted!");
      setShares((prev) => [...prev, body]);
    } catch {
      addToast("error", "Network error — share not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Revoke access ───────────────────────────────────────────────────────────
  const handleRevoke = async (shareId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/shares/${shareId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Unknown error" }));
        addToast("error", `Failed to revoke access: ${error}`);
        return;
      }
      addToast("success", "Access revoked.");
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      addToast("error", "Network error — could not revoke access.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Determine which users can be invited ────────────────────────────────────
  const alreadySharedIds = new Set(shares.map((s) => s.userId));
  const ownerProfile = USER_PROFILES.find((p) => p.name === ownerName);
  const invitableUsers = USER_PROFILES.filter(
    (p) => p.name !== ownerName && !alreadySharedIds.has(p.id)
  );

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Share document"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Share Document</h2>
              <p className="text-[10px] text-zinc-400 truncate max-w-[260px]">{documentTitle}</p>
            </div>
          </div>
          <Button variant="ghost" size="xs" icon={<X size={14} />} onClick={onClose} aria-label="Close" />
        </div>

        <div className="p-5 space-y-5">
          {/* Owner row */}
          <div>
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Owner</p>
            <div className="flex items-center gap-2.5 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
              {ownerProfile && (
                <Avatar initials={ownerProfile.avatar} color={ownerProfile.color} size="sm" title={ownerProfile.name} />
              )}
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex-1">{ownerName}</span>
              <Badge variant="owned">
                <Crown size={9} /> Owner
              </Badge>
            </div>
          </div>

          {/* Current shares */}
          <div>
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              People with access
            </p>

            {isLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : shares.length === 0 ? (
              <p className="text-xs text-zinc-400 py-2 text-center">No one else has access yet.</p>
            ) : (
              <ul className="space-y-2">
                {shares.map((share) => {
                  const profile = USER_PROFILES.find((p) => p.id === share.userId);
                  if (!profile) return null;
                  return (
                    <li key={share.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40">
                      <Avatar initials={profile.avatar} color={profile.color} size="sm" title={profile.name} />
                      <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">{profile.name}</span>
                      <Badge variant={share.permission === SHARE_PERMISSIONS.EDIT ? "edit" : "view"}>
                        {share.permission}
                      </Badge>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="xs"
                          icon={<Trash2 size={13} />}
                          loading={isSaving}
                          onClick={() => handleRevoke(share.id)}
                          aria-label={`Revoke access for ${profile.name}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Grant access — only the owner can share */}
          {isOwner && invitableUsers.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Invite someone
              </p>

              {/* Permission selector */}
              <div className="flex gap-2 mb-3">
                {(Object.values(SHARE_PERMISSIONS) as SharePermission[]).map((perm) => (
                  <button
                    key={perm}
                    onClick={() => setSelectedPermission(perm)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      selectedPermission === perm
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                    }`}
                  >
                    {perm === SHARE_PERMISSIONS.VIEW ? "Can view" : "Can edit"}
                  </button>
                ))}
              </div>

              {/* User list to invite */}
              <ul className="space-y-2">
                {invitableUsers.map((profile) => (
                  <li key={profile.id} className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <Avatar initials={profile.avatar} color={profile.color} size="sm" title={profile.name} />
                    <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">{profile.name}</span>
                    <Button
                      variant="primary"
                      size="xs"
                      icon={<UserPlus size={12} />}
                      loading={isSaving}
                      onClick={() => handleGrant(profile.id)}
                      aria-label={`Grant ${profile.name} ${selectedPermission} access`}
                    >
                      Invite
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!isOwner && (
            <p className="text-xs text-zinc-400 text-center pt-2">
              Only the document owner can manage sharing.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
