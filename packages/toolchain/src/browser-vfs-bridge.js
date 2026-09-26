function requireMethod(value, name, label) {
  if (!value || typeof value[name] !== 'function') {
    throw new TypeError(label + ' requires ' + name + '()');
  }
}

function normalizeWorkspaceRoot(value) {
  const root = String(value ?? '/workspace').replace(/\/+$/, '');
  if (!root.startsWith('/')) throw new TypeError('workspaceRoot must be absolute');
  return root || '/';
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return value;
}

export function createBrowserToolchainVfsBridge({
  memfs,
  sourceFs,
  writableFs = sourceFs,
  pathApi,
  workspaceRoot = '/workspace'
} = {}) {
  const memfsFs = memfs?.fs ?? memfs;
  requireMethod(memfsFs, 'mkdirSync', 'memfs');
  requireMethod(memfsFs, 'writeFileSync', 'memfs');
  requireMethod(sourceFs, 'readFileSync', 'sourceFs');
  requireMethod(sourceFs, 'statSync', 'sourceFs');
  requireMethod(sourceFs, 'readdirSync', 'sourceFs');
  requireMethod(writableFs, 'mkdirSync', 'writableFs');
  requireMethod(writableFs, 'writeFileSync', 'writableFs');
  requireMethod(pathApi, 'dirname', 'pathApi');
  requireMethod(pathApi, 'resolve', 'pathApi');

  const root = normalizeWorkspaceRoot(workspaceRoot);

  const memfsTargets = (sourcePath) => {
    const canonical = pathApi.resolve(String(sourcePath));
    const targets = new Set([canonical]);
    if (root !== '/' && (canonical === root || canonical.startsWith(root + '/'))) {
      const relative = canonical.slice(root.length) || '/';
      targets.add(relative.startsWith('/') ? relative : '/' + relative);
    }
    return [...targets];
  };

  const mirrorFile = (sourcePath) => {
    const canonical = pathApi.resolve(String(sourcePath));
    const data = bytesOf(sourceFs.readFileSync(canonical));
    const targets = memfsTargets(canonical);
    for (const target of targets) {
      memfsFs.mkdirSync(pathApi.dirname(target), { recursive: true });
      memfsFs.writeFileSync(target, data);
    }
    return Object.freeze({ source: canonical, targets: Object.freeze(targets) });
  };

  const mirrorTree = (sourceRoot, { include = null } = {}) => {
    const start = pathApi.resolve(String(sourceRoot));
    const mirrored = [];
    const walk = (current) => {
      const stat = sourceFs.statSync(current);
      if (stat.isDirectory()) {
        for (const name of sourceFs.readdirSync(current)) {
          walk(pathApi.resolve(current, String(name)));
        }
        return;
      }
      if (!stat.isFile()) {
        throw new TypeError('Browser toolchain bridge only mirrors regular files: ' + current);
      }
      if (typeof include === 'function' && include(current, stat) !== true) return;
      mirrored.push(mirrorFile(current));
    };
    walk(start);
    return Object.freeze(mirrored);
  };

  const plugin = {
    name: 'opencontainer-browser-toolchain-vfs-bridge',
    writeBundle(options, bundle) {
      const outputDir = options?.dir ? pathApi.resolve(String(options.dir)) : '';
      if (!outputDir) return;
      writableFs.mkdirSync(outputDir, { recursive: true });
      for (const output of Object.values(bundle ?? {})) {
        if (!output?.fileName) continue;
        const target = pathApi.resolve(outputDir, String(output.fileName));
        writableFs.mkdirSync(pathApi.dirname(target), { recursive: true });
        if (output.type === 'asset') {
          writableFs.writeFileSync(target, bytesOf(output.source));
          continue;
        }
        writableFs.writeFileSync(target, String(output.code ?? ''), 'utf8');
        if (
          output.map &&
          !Object.values(bundle).some((entry) => entry?.fileName === output.fileName + '.map')
        ) {
          writableFs.writeFileSync(target + '.map', output.map.toString(), 'utf8');
        }
      }
    }
  };

  return Object.freeze({
    workspaceRoot: root,
    mirrorFile,
    mirrorTree,
    plugin: Object.freeze(plugin)
  });
}
