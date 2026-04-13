export const sanitizeString = (s: string, maxLen = 500): string =>
  s.replace(/[<>'";&\\]/g, "").trim().slice(0, maxLen);

export const sanitizeArray = (arr: string[], maxLen = 64): string[] =>
  arr.map((s) => sanitizeString(s, maxLen)).filter(Boolean);

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidUUID = (s: string): boolean => uuidPattern.test(s);
export const isValidEthAddress = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s);
