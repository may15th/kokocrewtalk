import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
await mkdir('dist/static', { recursive: true });
const source = await readFile('static/index.html', 'utf8');
const html = source.replace(/<script>[\s\S]*?<\/script>/, '<script src="/static/client.js" defer></script>');
await writeFile('dist/index.html', html);
await cp('static/stickers', 'dist/static/stickers', { recursive: true });
await cp('cloudflare/client.js', 'dist/static/client.js');
console.log('Built existing UI, client, and ten PNG stickers only.');
