import { appendFileSync } from 'node:fs';
const env = process.env;
process.env = new Proxy(env, {
  get(target, key) {
    if (key === 'BRIGHT_DATA_API_KEY') appendFileSync(target.SYNTHETIC_CREDENTIAL_READS, 'read\n');
    return Reflect.get(target, key);
  },
});
