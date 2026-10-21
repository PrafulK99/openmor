// Fixed AES-256 key for tests. No imports, so vi.mock factories can load it safely.
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7);
export const TEST_ENCRYPTION_KEY_B64 = TEST_ENCRYPTION_KEY.toString("base64");
