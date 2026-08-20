// Run: node scripts/generate-postman.js
'use strict';
const fs = require('fs');
const path = require('path');

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'openapi.json'), 'utf8'));

function exampleFromSchema(schema) {
  if (!schema) return undefined;
  if (schema.$ref) return {}; // component schemas resolved loosely — Postman doesn't need full resolution to be useful
  if (schema.allOf) return schema.allOf.reduce((acc, s) => ({ ...acc, ...exampleFromSchema(s) }), {});
  if (schema.type === 'object' && schema.properties) {
    const obj = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (propSchema.example !== undefined) obj[key] = propSchema.example;
      else if (propSchema.type === 'string') obj[key] = propSchema.enum ? propSchema.enum[0] : '';
      else if (propSchema.type === 'number' || propSchema.type === 'integer') obj[key] = 0;
      else if (propSchema.type === 'boolean') obj[key] = false;
      else if (propSchema.type === 'array') obj[key] = [];
      else obj[key] = null;
    }
    return obj;
  }
  return {};
}

const folders = {};
for (const [urlPath, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = op.tags[0];
    if (!folders[tag]) folders[tag] = { name: tag, item: [] };

    const postmanPath = urlPath.replace(/\{([^}]+)\}/g, ':$1');
    const item = {
      name: op.summary,
      request: {
        method: method.toUpperCase(),
        header: [{ key: 'Content-Type', value: 'application/json' }],
        url: { raw: `{{baseUrl}}${postmanPath}`, host: ['{{baseUrl}}'], path: postmanPath.split('/').filter(Boolean) },
        description: op.description || '',
      },
    };

    if (op.security) {
      item.request.header.push({ key: 'Authorization', value: 'Bearer {{accessToken}}' });
    }

    if (op.requestBody) {
      const schema = op.requestBody.content['application/json'].schema;
      item.request.body = { mode: 'raw', raw: JSON.stringify(exampleFromSchema(schema), null, 2), options: { raw: { language: 'json' } } };
    }

    const queryParams = (op.parameters || []).filter((p) => p.in === 'query');
    if (queryParams.length) {
      item.request.url.query = queryParams.map((p) => ({ key: p.name, value: '', disabled: true }));
    }

    folders[tag].item.push(item);
  }
}

const collection = {
  info: {
    name: 'Fixify API',
    description: 'Auto-generated from docs/api/openapi.json — one folder per module. Import alongside a "Fixify Local" environment (baseUrl=http://localhost:5000, accessToken=<paste after login>).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'baseUrl', value: 'http://localhost:5000' }, { key: 'accessToken', value: '' }],
  item: Object.values(folders),
};

const outPath = path.join(__dirname, '..', 'docs', 'api', 'fixify.postman_collection.json');
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));
console.log(`Wrote ${outPath} — ${Object.keys(folders).length} folders, ${Object.values(folders).reduce((n, f) => n + f.item.length, 0)} requests.`);
