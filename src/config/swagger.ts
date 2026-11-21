import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { type Env, env as appEnv } from './env.js';

export const SWAGGER_PATH = 'docs';

/**
 * Swagger UI is served in every environment except production, unless
 * SWAGGER_ENABLED is set explicitly ("true" / "false").
 */
export function isSwaggerEnabled(
  env: Pick<Env, 'NODE_ENV' | 'SWAGGER_ENABLED'> = appEnv,
): boolean {
  return env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
}

function packageVersion(): string {
  try {
    // src/config/ and dist/config/ both sit two levels below package.json.
    const pkg = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'package.json'),
        'utf8',
      ),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Serves the OpenAPI document:
 * - Swagger UI at   /docs
 * - JSON document at /docs-json
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Backend API')
    .setDescription('HTTP API for the RTF-201 backend.')
    .setVersion(packageVersion())
    .addBearerAuth()
    .build();

  const documentFactory = () => {
    const document = SwaggerModule.createDocument(app, config);
    // setup() serves the document outside Nest's router, so list it explicitly.
    document.paths[`/${SWAGGER_PATH}-json`] = {
      get: {
        tags: ['Docs'],
        summary: 'This OpenAPI document',
        responses: { '200': { description: 'The OpenAPI document (JSON)' } },
      },
    };
    return document;
  };

  SwaggerModule.setup(SWAGGER_PATH, app, documentFactory, {
    swaggerOptions: { persistAuthorization: true },
  });
}
