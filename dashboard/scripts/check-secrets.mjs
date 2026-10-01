#!/usr/bin/env node
// Usage: node scripts/check-secrets.mjs [dist]
//
// Fails the build if any backend secret reached the files the site serves: a JWT with
// role=service_role (or supabase_admin), a Supabase `sb_secret_` key, the literal value
// of SUPABASE_SERVICE_ROLE_KEY when that variable is set, or a desk-config.json with
// anything beyond { url, anonKey } (see secret-scan.mjs). CI runs it after every build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { checkDeskConfig, scanText } from './secret-scan.mjs';

const dir = resolve(process.argv[2] ?? 'dist');
const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.webmanifest', '.xml']);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let problems = 0;
let scanned = 0;
for (const file of files(dir)) {
  if (!TEXT.has(extname(file).toLowerCase())) continue;
  const text = readFileSync(file, 'utf8');
  scanned++;
  const rel = relative(dir, file);
  for (const f of scanText(text)) {
    console.error(`::error file=${rel}::${f.kind}: ${f.detail}`);
    problems++;
  }
  if (serviceKey && text.includes(serviceKey)) {
    console.error(`::error file=${rel}::the SUPABASE_SERVICE_ROLE_KEY value appears in this file`);
    problems++;
  }
  if (rel.replace(/\\/g, '/') === 'desk-config.json') {
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // reported below
    }
    for (const p of body ? checkDeskConfig(body) : ['not valid JSON']) {
      console.error(`::error file=${rel}::${p}`);
      problems++;
    }
  }
}
if (problems) {
  console.error(`Secret check failed: ${problems} problem(s) in ${dir}.`);
  process.exit(1);
}
console.log(`Secret check passed: ${scanned} text files in ${relative(process.cwd(), dir) || dir} carry no backend secret.`);
