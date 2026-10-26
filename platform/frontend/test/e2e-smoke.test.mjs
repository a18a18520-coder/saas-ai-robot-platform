import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('production bundle contains a bootable application shell and referenced assets', () => {
  const indexPath = join(root, 'dist/index.html');
  assert.ok(existsSync(indexPath), 'dist/index.html is missing');
  const html = readFileSync(indexPath, 'utf8');
  assert.match(html, /<div id="root"><\/div>/);

  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assetPaths.some((path) => path.endsWith('.js')), 'compiled JavaScript entry is missing');
  assert.ok(assetPaths.some((path) => path.endsWith('.css')), 'compiled stylesheet is missing');
  for (const assetPath of assetPaths) assert.ok(existsSync(join(root, 'dist', assetPath)), `referenced asset is missing: ${assetPath}`);

  assert.ok(existsSync(join(root, 'dist/chat-widget.html')), 'public chat widget was not copied to the production bundle');
  const widget = readFileSync(join(root, 'dist/chat-widget.html'), 'utf8');
  assert.match(widget, /channelId/);
  assert.match(widget, /siteKey/);
  assert.match(widget, /siteOrigin/);
  assert.doesNotMatch(widget, /q\.get\('tenantId'\)/, 'widget must not expose tenant identifiers in its public URL');
});
