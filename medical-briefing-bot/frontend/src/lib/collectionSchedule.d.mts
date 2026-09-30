export const COLLECTION_RUNTIME_SCHEDULE_KST: readonly ['08:30', '12:07', '15:07', '17:07'];
export const COLLECTION_DISPLAY_SCHEDULE_KST: readonly ['08:30', '12:00', '15:00', '17:00'];

export function getKstDateKey(value?: Date | string | number): string;
export function shiftKstDate(dateKey: string, offsetDays: number): string;
export function getLatestCollectionRuntimeTime(value?: Date | string | number): typeof COLLECTION_RUNTIME_SCHEDULE_KST[number];
export function getLatestCollectionDisplayTime(value?: Date | string | number): typeof COLLECTION_DISPLAY_SCHEDULE_KST[number];
export function getNextCollectionRuntimeTime(value?: Date | string | number): typeof COLLECTION_RUNTIME_SCHEDULE_KST[number];
export function getCollectionCutoffIso(dateKey: string, runtimeTime: string): string;
