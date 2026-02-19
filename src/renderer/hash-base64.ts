// Standard base64 alphabet used by the WoW talent import/export system.
// Bits are packed LSB-first: bit 0 of each 6-bit character is the first
// bit in the stream.
export const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
