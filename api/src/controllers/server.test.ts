import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerService } from '../services/server.js';
import { createMockRequest, createMockResponse, getRouteHandler } from '../test-utils/controllers.js';
import router from './server.js';

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => ({})),
}));

vi.mock('../services/index.js', () => ({
	SettingsService: vi.fn(),
}));

vi.mock('../middleware/respond.js', () => ({
	respond: vi.fn(),
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

const healthHandler = getRouteHandler(router, 'GET', '/health')[0]!.handle;

function createHealthResponse() {
	const res = createMockResponse() as ReturnType<typeof createMockResponse> & { statusCode: number };

	res.statusCode = 200;
	res.status = vi.fn((statusCode: number) => {
		res.statusCode = statusCode;
		return res;
	}) as any;

	res.setHeader = vi.fn(() => res) as any;

	return res;
}

describe('server controller', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /health', () => {
		//harness:criterion=c-health-status-code-200-ok,c-health-status-code-200-warn,c-health-status-code-503-error,c-health-header-set-ok,c-health-header-set-warn,c-health-header-set-error,c-health-locals-payload-preserved,c-health-cache-false-preserved
		test.each([
			['ok', 200],
			['warn', 200],
			['error', 503],
		] as const)('sets health response metadata for %s status', async (status, expectedStatusCode) => {
			const health = {
				status,
				releaseId: 'release-id',
				serviceId: 'service-id',
				checks: {
					database: {
						status,
					},
				},
			};

			vi.mocked(ServerService.prototype.health).mockResolvedValue(health as any);

			const req = createMockRequest();
			const res = createHealthResponse();
			const next = vi.fn();

			await healthHandler(req, res, next);

			expect(res.statusCode).toBe(expectedStatusCode);
			expect(res.setHeader).toHaveBeenCalledWith('X-Directus-Health-Status', status);
			expect(res.locals['payload']).toBe(health);
			expect(res.locals['cache']).toBe(false);
			expect(next).toHaveBeenCalledWith();
		});
	});
});
