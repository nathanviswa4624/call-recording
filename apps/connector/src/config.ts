import { z } from 'zod';

const schema = z.object({
  CONNECTOR_HOST: z.string().default('127.0.0.1'),
  CONNECTOR_PORT: z.coerce.number().int().default(4100),
  CONNECTOR_TOKEN: z.string().min(16),
  ASTERISK_HOST: z.string().default('127.0.0.1'),
  ASTERISK_AMI_PORT: z.coerce.number().int().default(5038),
  ASTERISK_AMI_USERNAME: z.string().min(1),
  ASTERISK_AMI_PASSWORD: z.string().min(1),
  ASTERISK_ARI_URL: z.string().url().default('http://127.0.0.1:8088/ari'),
  ASTERISK_ARI_USERNAME: z.string().default(''),
  ASTERISK_ARI_PASSWORD: z.string().default(''),
  ASTERISK_CONFIG_DIR: z.string().default('/etc/asterisk'),
  RECORDING_BASE_PATH: z.string().default('/var/spool/asterisk/recording'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ConnectorConfig = z.infer<typeof schema>;

export function loadConfig(): ConnectorConfig {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    throw new Error(`Invalid connector configuration:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return r.data;
}
