/**
 * A short content hash of everything in public/data (paths + bytes), baked into the
 * build as the `?v=` query on every data URL. GitHub Pages caches JSON for ~10 minutes,
 * so a fixed URL let returning visitors pair a new app with old data after a deploy;
 * with the hash, each deploy's app asks for exactly its own data, and an unchanged
 * dataset keeps its cache.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function listFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

export function dataVersion(dir) {
  if (!existsSync(dir)) return 'dev';
  const hash = createHash('sha256');
  for (const file of listFiles(dir)) {
    // source.json carries a fetch timestamp; it doesn't change the data.
    if (relative(dir, file) === 'source.json') continue;
    hash.update(relative(dir, file).split('\\').join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
