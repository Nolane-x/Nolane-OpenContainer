function assertFileUrl(url) {
  if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  if (url.hostname && url.hostname !== 'localhost') throw new TypeError('File URL host must be empty or localhost');
  if (/%2f|%5c/i.test(url.pathname)) throw new TypeError('File URL path must not include encoded separators');
}

export function createUrlBuiltin({ path }) {
  function pathToFileURL(value) {
    if (typeof value !== 'string') throw new TypeError('path must be a string');
    const absolute = path.resolve(value);
    const pathname = absolute.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/');
    return new URL('file://' + pathname);
  }

  function fileURLToPath(value) {
    const url = value instanceof URL ? value : new URL(value);
    assertFileUrl(url);
    return decodeURIComponent(url.pathname);
  }

  function urlToHttpOptions(value) {
    const url = value instanceof URL ? value : new URL(value);
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      hash: url.hash,
      search: url.search,
      pathname: url.pathname,
      path: url.pathname + url.search,
      href: url.href
    };
    if (url.port) options.port = Number(url.port);
    if (url.username || url.password) {
      options.auth = decodeURIComponent(url.username) + ':' + decodeURIComponent(url.password);
    }
    return options;
  }

  return Object.freeze({
    URL,
    URLSearchParams,
    pathToFileURL,
    fileURLToPath,
    urlToHttpOptions,
    domainToASCII: (value) => new URL('http://' + value).hostname,
    domainToUnicode: (value) => new URL('http://' + value).hostname
  });
}
