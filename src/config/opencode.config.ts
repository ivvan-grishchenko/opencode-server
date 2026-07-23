import { ConfigTokenEnum } from '@config/config.enum';
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const OpencodeConfigSchema = z.object({
	apiKey: z.string().min(1),
	password: z.string().min(1),
	username: z.string().min(1).default('opencode'),
});

type OpencodeConfigType = z.infer<typeof OpencodeConfigSchema>;

const OpencodeConfig = registerAs<OpencodeConfigType>(ConfigTokenEnum.OPENCODE, () =>
	OpencodeConfigSchema.parse({
		apiKey: process.env.OPENCODE_API_KEY,
		password: process.env.OPENCODE_SERVER_PASSWORD,
		username: process.env.OPENCODE_SERVER_USERNAME,
	})
);

export type { OpencodeConfigType };
export { OpencodeConfig };
