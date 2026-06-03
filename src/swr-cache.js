export function createSWRCache(storage, version) {
  function read(key) {
    try {
      const raw = storage.getItem(key);
      if (raw == null) return null;
      const record = JSON.parse(raw);
      if (!record || record.v !== version) return null;
      return 'data' in record ? record.data : null;
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify({ v: version, data: value }));
    } catch {
      // storage may be full or disabled
    }
  }

  return { read, write };
}
