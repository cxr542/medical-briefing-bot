import { readFile } from 'node:fs/promises';

export const notificationMigration = await readFile(new URL('../../../supabase/migrations/20261029082347_support_email_notifications.sql', import.meta.url), 'utf8');
export function notificationStore(db) {
  return { record: (operation, requestId) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query('SELECT public.support_email_notification_rpc($1,$2::uuid) AS result', [operation, requestId])).rows[0].result;
  }) };
}
