import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/publish-worker.yml',import.meta.url),'utf8');
test('missing Cloudflare publish credentials must NOT count as successful deployment',()=>{
 const check=workflow.indexOf('- name: Check deployment credentials');
 const gate=workflow.indexOf('- name: Report blocked release as failure');
 const publish=workflow.indexOf('- name: Publish tested Worker');
 assert.ok(check>=0&&gate>check&&publish>gate,'credential guard must precede any Worker publishing');
 const blocked=workflow.slice(gate,publish);
 assert.match(blocked,/if: steps\.credential\.outputs\.ready != 'true'/);
 assert.match(blocked,/Worker deployment BLOCKED/);
 assert.match(blocked,/NOT deployed/);
 assert.match(blocked,/CLOUDFLARE_API_TOKEN/);
 assert.match(blocked,/CLOUDFLARE_ACCOUNT_ID/);
 assert.match(blocked,/exit 1/);
});
test('Worker release only deploys with credentials and verifies the live endpoint',()=>{
 assert.match(workflow,/if: steps\.credential\.outputs\.ready == 'true'/);
 assert.match(workflow,/cloudflare\/wrangler-action@v3/);
 assert.match(workflow,/command: deploy --config wrangler\.jsonc/);
 assert.match(workflow,/Verify published release without database reads/);
 assert.match(workflow,/node scripts\/verify-published-release\.mjs/);
});
