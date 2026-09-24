import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { NetworkAuthority } from '../packages/network/src/index.js';
import { PackageArtifactAuthority, inspectTarArchive, verifySri } from '../packages/package-env/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const encoder = new TextEncoder();

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  buffer.set(encoder.encode(text), offset);
}

function tarEntry(path, content = '', type = '0') {
  const data = content instanceof Uint8Array ? content : encoder.encode(content);
  const header = new Uint8Array(512);
  header.set(encoder.encode(path), 0);
  writeOctal(header, 100, 8, type === '5' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === '5' ? 0 : data.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.set(encoder.encode('ustar\0'), 257);
  header.set(encoder.encode('00'), 263);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(encoder.encode(checksumText), 148);

  const padded = Math.ceil(data.byteLength / 512) * 512;
  const out = new Uint8Array(512 + padded);
  out.set(header, 0);
  out.set(data, 512);
  return out;
}

function tar(entries) {
  const chunks = entries.map((entry) => tarEntry(entry.path, entry.content, entry.type ?? '0'));
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) + 1024;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function sri(bytes) {
  return 'sha512-' + createHash('sha512').update(bytes).digest('base64');
}

test('SRI verifier accepts exact sha512 and rejects mutation', async () => {
  const bytes = encoder.encode('artifact');
  assert.equal((await verifySri(bytes, sri(bytes))).algorithm, 'sha512');

  const changed = encoder.encode('artifact!');
  await assert.rejects(
    () => verifySri(changed, sri(bytes)),
    (error) => error.code === ErrorCodes.ARTIFACT_INTEGRITY
  );
});

test('safe package tar installs transactionally into VFS', async () => {
  const bytes = tar([
    { path: 'package/', type: '5' },
    { path: 'package/package.json', content: '{"name":"demo"}' },
    { path: 'package/src/index.js', content: 'export default 1' }
  ]);

  const fs = new MemoryVFS();
  const net = new NetworkAuthority();
  const authority = new PackageArtifactAuthority({ fs, network: net });
  const receipt = await authority.installTarball({ bytes, destination: '/workspace/node_modules/demo' });

  assert.equal(receipt.files, 2);
  assert.equal(fs.readFile('/workspace/node_modules/demo/package.json'), '{"name":"demo"}');
  assert.equal(fs.readFile('/workspace/node_modules/demo/src/index.js'), 'export default 1');
});

test('tar path traversal is rejected before VFS publication', async () => {
  const bytes = tar([{ path: 'package/../../escape.js', content: 'bad' }]);
  await assert.rejects(
    () => inspectTarArchive(bytes),
    (error) => error.code === ErrorCodes.ARCHIVE_UNSAFE
  );
});

test('tar links and special entries are rejected', async () => {
  const bytes = tar([{ path: 'package/link', content: '', type: '2' }]);
  await assert.rejects(
    () => inspectTarArchive(bytes),
    (error) => error.code === ErrorCodes.ARCHIVE_UNSAFE
  );
});

test('tar header corruption is rejected', async () => {
  const bytes = tar([{ path: 'package/a.txt', content: 'a' }]);
  bytes[10] ^= 1;
  await assert.rejects(
    () => inspectTarArchive(bytes),
    (error) => error.code === ErrorCodes.ARCHIVE_UNSAFE
  );
});

test('artifact fetch is network-authorized, size-bounded and integrity-checked', async () => {
  const bytes = encoder.encode('package bytes');
  const fs = new MemoryVFS();
  const net = new NetworkAuthority().allow({ origin: 'https://registry.example', methods: ['GET'], paths: ['/pkg/'] });
  let fetched = 0;
  const authority = new PackageArtifactAuthority({
    fs,
    network: net,
    maxArtifactBytes: 1024,
    fetchImpl: async (url, options) => {
      fetched++;
      assert.equal(url, 'https://registry.example/pkg/a.tgz');
      assert.equal(options.redirect, 'manual');
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
    }
  });

  const artifact = await authority.fetchArtifact({
    url: 'https://registry.example/pkg/a.tgz',
    integrity: sri(bytes)
  });

  assert.equal(fetched, 1);
  assert.deepEqual(artifact.bytes, bytes);
});


test('artifact redirects are authorized hop by hop', async () => {
  const bytes = encoder.encode('redirected package');
  const fs = new MemoryVFS();
  const net = new NetworkAuthority()
    .allow({ origin: 'https://registry.example', methods: ['GET'], paths: ['/pkg/'] })
    .allow({ origin: 'https://cdn.example', methods: ['GET'], paths: ['/artifacts/'] });
  const fetched = [];
  const authority = new PackageArtifactAuthority({
    fs,
    network: net,
    fetchImpl: async (url, options) => {
      fetched.push([url, options.redirect]);
      if (url === 'https://registry.example/pkg/a.tgz') {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.example/artifacts/a.tgz' } });
      }
      return new Response(bytes, { status: 200 });
    }
  });

  const artifact = await authority.fetchArtifact({
    url: 'https://registry.example/pkg/a.tgz',
    integrity: sri(bytes)
  });

  assert.equal(artifact.url, 'https://cdn.example/artifacts/a.tgz');
  assert.equal(artifact.redirects, 1);
  assert.deepEqual(fetched, [
    ['https://registry.example/pkg/a.tgz', 'manual'],
    ['https://cdn.example/artifacts/a.tgz', 'manual']
  ]);
});

test('artifact redirect cannot escape network capability', async () => {
  const bytes = encoder.encode('package');
  const fs = new MemoryVFS();
  const net = new NetworkAuthority()
    .allow({ origin: 'https://registry.example', methods: ['GET'], paths: ['/pkg/'] });
  let fetched = 0;
  const authority = new PackageArtifactAuthority({
    fs,
    network: net,
    fetchImpl: async () => {
      fetched++;
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/a.tgz' } });
    }
  });

  await assert.rejects(
    () => authority.fetchArtifact({
      url: 'https://registry.example/pkg/a.tgz',
      integrity: sri(bytes)
    }),
    (error) => error.code === ErrorCodes.NETWORK_DENIED
  );
  assert.equal(fetched, 1, 'redirect target must be authorized before it is fetched');
});
