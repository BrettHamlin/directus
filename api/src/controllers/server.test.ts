import type { Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerService } from '../services/server.js';
import { createMockRequest, createMockResponse, getRouteHandler } from '../test-utils/controllers.js';
import { default as router } from './server.js';

vi.mock('../services/index.js', () => ({
	SettingsService: vi.fn(),
}));

vi.mock('../services/server.js', () => {
	const ServerService = vi.fn();
	ServerService.prototype.health = vi.fn();
	return { ServerService };
});

vi.mock('../services/specifications.js', () => ({
	SpecificationService: vi.fn(),
}));

vi.mock('../utils/create-admin.js', () => ({
	createAdmin: vi.fn(),
}));

type HealthStatus = 'ok' | 'warn' | 'error';

const health = vi.mocked(ServerService.prototype.health);

function createHealthResponse() {
	return createMockResponse({
		setHeader: vi.fn().mockReturnThis(),
	}) as Response & { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

async function callHealthHandler(data: Record<string, any>, admin = true) {
	health.mockResolvedValueOnce(data);

	const req = createMockRequest({
		accountability: { admin } as any,
	});

	const res = createHealthResponse();
	const next = vi.fn();

	const [handler] = getRouteHandler(router, 'GET', '/health');
	await handler?.handle(req, res, next);

	return { next, res };
}

describe('server controller', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /health', () => {
		test.each<HealthStatus>(['ok', 'warn', 'error'])(
			'sets the health status response header for %s status',
			async (status) => {
				//harness:criterion=c-health-header-present-on-ok,c-health-header-present-on-warn,c-health-header-present-on-error,c-health-header-value-exact-string
				const data = {
					status,
					releaseId: 'test-release',
					serviceId: 'test-service',
					checks: {},
				};

				const { res } = await callHealthHandler(data);
				const directusHealthStatusHeaderCalls = res.setHeader.mock.calls.filter(
					([header]) => header === 'X-Directus-Health-Status',
				);

				expect(res.setHeader).toHaveBeenCalledWith('X-Directus-Health-Status', data.status);
				expect(directusHealthStatusHeaderCalls).toHaveLength(1);
				expect(directusHealthStatusHeaderCalls[0]?.[1]).toBe(data.status);
			},
		);

		test.each<HealthStatus>(['ok', 'warn', 'error'])(
			'continues to set the health content type for %s status',
			async (status) => {
				//harness:criterion=c-health-content-type-preserved
				const { res } = await callHealthHandler({
					status,
					releaseId: 'test-release',
					serviceId: 'test-service',
					checks: {},
				});

				expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/health+json');
			},
		);

		test('sets the full service health payload for admin callers', async () => {
			//harness:criterion=c-health-body-admin-unchanged,c-health-header-additive-no-body-removal
			const data = {
				status: 'ok',
				releaseId: 'test-release',
				serviceId: 'test-service',
				checks: {
					database: [
						{
							componentType: 'datastore',
							status: 'ok',
							observedValue: true,
						},
					],
				},
			};

			const { res } = await callHealthHandler(data);

			expect(res.locals['payload']).toEqual(data);
		});

		test('sets the redacted service health payload for non-admin callers', async () => {
			//harness:criterion=c-health-body-redacted-unchanged,c-health-header-additive-no-body-removal
			const data = { status: 'warn' };

			const { res } = await callHealthHandler(data, false);

			expect(res.locals['payload']).toEqual({ status: 'warn' });
			expect(Object.keys(res.locals['payload'])).toHaveLength(1);
		});

		test('sets a 503 response status for error health status', async () => {
			//harness:criterion=c-health-503-on-error-status
			const { res } = await callHealthHandler({
				status: 'error',
				releaseId: 'test-release',
				serviceId: 'test-service',
				checks: {},
			});

			expect(res.status).toHaveBeenCalledWith(503);
			expect(res.status).toHaveBeenCalledTimes(1);
		});

		test.each<HealthStatus>(['ok', 'warn'])(
			'does not set a 503 response status for %s health status',
			async (status) => {
				//harness:criterion=c-health-no-503-on-ok,c-health-no-503-on-warn
				const { res } = await callHealthHandler({
					status,
					releaseId: 'test-release',
					serviceId: 'test-service',
					checks: {},
				});

				expect(res.status).not.toHaveBeenCalledWith(503);
			},
		);
	});
});
