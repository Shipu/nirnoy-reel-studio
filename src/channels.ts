/** Client for connected channels and publishing (see worker/channels.ts and worker/publish.ts). */

export type Channel = {
  id: number;
  platform: "facebook" | "instagram";
  account_id: string;
  name: string;
  picture: string | null;
  status: string;
  error: string | null;
  connected_by: string | null;
  created_at: string;
};
export type PendingAccount = { id: string; name: string; picture: string | null; connected: boolean };
export type PublishStatus = "scheduled" | "scheduled_remote" | "publishing" | "published" | "failed" | "canceled";
export type Publish = {
  id: number;
  reel_id: number;
  channel_id: number;
  platform: Channel["platform"];
  caption: string;
  scheduled_at: string | null;
  status: PublishStatus;
  url: string | null;
  error: string | null;
  created_at: string;
  channel_name: string | null;
  channel_picture: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const PLATFORM_LABEL: Record<Channel["platform"], string> = { facebook: "Facebook Page", instagram: "Instagram" };
export const PUBLISH_LABEL: Record<PublishStatus, string> = {
  scheduled: "নির্ধারিত",
  scheduled_remote: "নির্ধারিত (Facebook-এ)",
  publishing: "যাচ্ছে…",
  published: "প্রকাশিত",
  failed: "ব্যর্থ",
  canceled: "বাতিল",
};

export const listChannels = () => request<{ data: Channel[]; platforms: Channel["platform"][] }>("/api/channels");
export const connectUrl = (platform: Channel["platform"]) => `/api/channels/${platform}/connect`;
export const pendingAccounts = (state: string) => request<{ platform: string; data: PendingAccount[] }>(`/api/channels/pending/${encodeURIComponent(state)}`);
export const addAccounts = (state: string, ids: string[]) =>
  request<{ added: number }>(`/api/channels/pending/${encodeURIComponent(state)}`, post({ account_ids: ids }));
export const removeChannel = (id: number) => request(`/api/channels/${id}`, { method: "DELETE" });

export const publishReel = (reelId: number, targets: { channel_id: number; caption: string }[], scheduledAt: string | null) =>
  request<{ created: number[] }>(`/api/reels/${reelId}/publish`, post({ targets, scheduled_at: scheduledAt }));
export const listPublishes = (reelId?: number) => request<{ data: Publish[] }>(`/api/publishes${reelId ? `?reel_id=${reelId}` : ""}`).then((r) => r.data);
export const retryPublish = (id: number) => request(`/api/publishes/${id}/retry`, { method: "POST" });
export const cancelPublish = (id: number) => request(`/api/publishes/${id}`, { method: "DELETE" });

/** "2026-11-10T20:00" typed as Bangladesh time → ISO UTC. */
export const dhakaToIso = (local: string) => new Date(`${local}:00+06:00`).toISOString();
/** Stored UTC "YYYY-MM-DD HH:MM:SS" → readable Bangladesh time. */
export const showDhaka = (utc: string) =>
  new Date(`${utc.replace(" ", "T")}Z`).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
