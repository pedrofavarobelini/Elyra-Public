

export const ID_CHUNK_SIZE = 150;

export function chunkIds<T>(ids: readonly T[], size: number = ID_CHUNK_SIZE): T[][] {
  if (ids.length <= size) return ids.length === 0 ? [] : [[...ids]];
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push([...ids.slice(index, index + size)]);
  }
  return chunks;
}
