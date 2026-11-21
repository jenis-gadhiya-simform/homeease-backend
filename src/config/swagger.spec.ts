import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../modules/app/app.controller.js';
import { AppService } from '../modules/app/app.service.js';
import { isSwaggerEnabled, setupSwagger } from './swagger.js';

describe('Swagger', () => {
  describe('isSwaggerEnabled', () => {
    it('is on outside production by default', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    });

    it('is off in production by default', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    });

    it('follows SWAGGER_ENABLED when it is set', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: true }),
      ).toBe(true);
      expect(
        isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: false }),
      ).toBe(false);
    });
  });

  describe('setupSwagger', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AppController],
        providers: [AppService],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      setupSwagger(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves the OpenAPI JSON with the app routes and its own route', async () => {
      const res = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.info.title).toBe('Backend API');
      expect(res.body.paths['/']).toHaveProperty('get');
      expect(res.body.paths['/docs-json']).toHaveProperty('get');
    });

    it('serves the Swagger UI', async () => {
      const res = await request(app.getHttpServer()).get('/docs').expect(200);
      expect(res.text).toContain('swagger-ui');
    });
  });
});
