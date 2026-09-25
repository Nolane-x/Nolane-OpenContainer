const encoder = new TextEncoder();

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeHex(value) {
  if (value.length % 2) value = value.slice(0, -1);
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index++) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return out.slice(0, index);
    out[index] = byte;
  }
  return out;
}

export class BufferCompat extends Uint8Array {
  static from(value, encodingOrOffset = undefined, length = undefined) {
    if (typeof value === 'string') {
      const encoding = encodingOrOffset ?? 'utf8';
      const normalized = String(encoding).toLowerCase();
      if (normalized === 'base64' || normalized === 'base64url') {
        const base64 = normalized === 'base64url'
          ? value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
          : value;
        return new BufferCompat(decodeBase64(base64));
      }
      if (normalized === 'hex') return new BufferCompat(decodeHex(value));
      if (!['utf8', 'utf-8'].includes(normalized)) throw new TypeError('Unsupported Buffer encoding: ' + encoding);
      return new BufferCompat(encoder.encode(value));
    }

    const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
    if (value instanceof ArrayBuffer || sharedArrayBuffer) {
      const byteOffset = encodingOrOffset === undefined ? 0 : Number(encodingOrOffset);
      if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > value.byteLength) {
        throw new RangeError('Buffer.from ArrayBuffer byteOffset is out of range');
      }
      const available = value.byteLength - byteOffset;
      const byteLength = length === undefined ? available : Number(length);
      if (!Number.isInteger(byteLength) || byteLength < 0 || byteLength > available) {
        throw new RangeError('Buffer.from ArrayBuffer length is out of range');
      }

      // Node's ArrayBuffer overload creates a view over the supplied backing store.
      // napi-wasm depends on this exact overload for WASM memory slices:
      // Buffer.from(memory.buffer, ptr, length).
      return new BufferCompat(value, byteOffset, byteLength);
    }

    if (ArrayBuffer.isView(value)) {
      return new BufferCompat(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (Array.isArray(value)) return new BufferCompat(value);
    throw new TypeError('Unsupported Buffer.from input');
  }

  static alloc(size, fill = 0, encoding = 'utf8') {
    const out = new BufferCompat(size);
    if (typeof fill === 'string') {
      const pattern = BufferCompat.from(fill, encoding);
      if (!pattern.length) return out;
      for (let index = 0; index < out.length; index++) out[index] = pattern[index % pattern.length];
    } else out.fill(Number(fill) & 0xff);
    return out;
  }

  static allocUnsafe(size) { return new BufferCompat(size); }
  static isBuffer(value) { return value instanceof BufferCompat; }
  static byteLength(value, encoding = 'utf8') { return BufferCompat.from(value, encoding).byteLength; }

  static concat(list, totalLength = undefined) {
    if (!Array.isArray(list)) throw new TypeError('list must be an Array of Buffers');
    const normalized = list.map((item) => BufferCompat.isBuffer(item) ? item : BufferCompat.from(item));
    const length = totalLength ?? normalized.reduce((sum, item) => sum + item.byteLength, 0);
    const out = BufferCompat.alloc(length);
    let offset = 0;
    for (const item of normalized) {
      if (offset >= length) break;
      const chunk = item.subarray(0, length - offset);
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  toString(encoding = 'utf8', start = 0, end = this.length) {
    const view = this.subarray(Math.max(0, start), Math.min(this.length, end));
    const normalized = String(encoding).toLowerCase();
    if (normalized === 'base64' || normalized === 'base64url') {
      const encoded = encodeBase64(view);
      return normalized === 'base64url' ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'') : encoded;
    }
    if (normalized === 'hex') return [...view].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!['utf8', 'utf-8'].includes(normalized)) throw new TypeError('Unsupported Buffer encoding: ' + encoding);
    return new TextDecoder().decode(view);
  }

  equals(other) {
    if (!(other instanceof Uint8Array) || other.byteLength !== this.byteLength) return false;
    for (let index = 0; index < this.length; index++) if (this[index] !== other[index]) return false;
    return true;
  }
}

export function createBufferBuiltin() {
  return Object.freeze({
    Buffer: BufferCompat,
    SlowBuffer: BufferCompat,
    INSPECT_MAX_BYTES: 50,
    kMaxLength: 0x7fffffff,
    atob: globalThis.atob?.bind(globalThis),
    btoa: globalThis.btoa?.bind(globalThis)
  });
}
