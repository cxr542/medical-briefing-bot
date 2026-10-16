export async function cleanupAttachments({ rpc, storage }) {
  const objects = await rpc('gc', {});
  for (const object of objects) {
    await storage.remove(object.bucket, object.object_path);
    await rpc('gc_done', object);
  }
  return objects.length;
}
