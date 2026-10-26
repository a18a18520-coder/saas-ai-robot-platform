// Isolated visual fixture: no login, production API, database or model access.
// Run from frontend: node test/collection-ui.mjs
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const backend = new URL('../../backend/', import.meta.url);
const require = createRequire(new URL('package.json', backend));
require('ts-node').register({ project: fileURLToPath(new URL('tsconfig.json', backend)), transpileOnly: true });
const { parseCollectionResult, validateCollectionConfig, CollectionValidationError } = require(fileURLToPath(new URL('src/robots/collection-config.ts', backend)));

const server = await createServer({
  configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [react(), {
    name: 'collection-ui-fixture',
    configureServer(server) {
      server.middlewares.use('/api/', async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url?.replace(/^\/+/, '').split('?')[0] !== 'v1/tenant/robots/fixture/collection-preview' || request.method !== 'POST') {
          response.statusCode = 404; response.end(JSON.stringify({ message: 'Only the synthetic preview endpoint is available' })); return;
        }
        try {
          const chunks = []; let bytes = 0;
          for await (const chunk of request) { bytes += chunk.length; if (bytes > 100000) throw new Error('Fixture request too large'); chunks.push(chunk); }
          const { config, content } = JSON.parse(Buffer.concat(chunks).toString());
          validateCollectionConfig(config, true);
          // A deliberate fixed model output makes changing the hard rules observable.
          const raw = JSON.stringify({ matched: true, reason: '合成测试响应', items: [{ values: { amount: 12000 }, evidence: { amount: '1.2万元' } }] });
          let data;
          try { data = { ...parseCollectionResult(raw, config, content), validationVersion: 2, validationErrors: [] }; }
          catch (error) {
            if (!(error instanceof CollectionValidationError)) throw error;
            data = { status: 'failed', items: [], reason: '结构化校验未通过；整条结果未接纳', validationVersion: 2, validationErrors: [error.issue] };
          }
          response.end(JSON.stringify({ code: 0, data }));
        } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ message: error.message })); }
      });
    },
  }], server: { host: '127.0.0.1', port: 5186, strictPort: true },
});
await server.listen();
console.log('Synthetic collection UI: http://127.0.0.1:5186/test/fixtures/collection.html');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
