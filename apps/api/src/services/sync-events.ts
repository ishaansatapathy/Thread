export type SyncEventType = "inbox_updated" | "calendar_updated";

export type SyncEvent = {
  type: SyncEventType;
  tenantId: string;
  at: string;
};

export {
  publishSyncPubSub as publishSyncEvent,
  subscribeSyncPubSub as subscribeSyncEvents,
  startSyncPubSubBridge as startSyncEventRedisBridge,
  resetSyncPubSubForTests as resetSyncEventListeners,
} from "@repo/services/cache/sync-pubsub";
