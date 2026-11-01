import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Human attestation is deliberate: local source cannot prove the billing plan.
if (process.env.KOKO_CONFIRMED_FREE_ACCOUNT !== 'YES') {
  console.error('배포 차단: Cloudflare 대시보드에서 대상 계정의 Workers Free 플랜과 유료 서비스 미사용을 확인하세요. docs/CLOUDFLARE.md 참고.');
  process.exit(1);
}
const config = readFileSync('wrangler.jsonc', 'utf8');
if (config.includes('00000000-0000-0000-0000-000000000000')) {
  console.error('배포 차단: 무료 계정에 만든 D1 database_id가 필요합니다.');
  process.exit(1);
}
for (const args of [['scripts/build-assets.mjs'], ['node_modules/wrangler/bin/wrangler.js', 'deploy']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
