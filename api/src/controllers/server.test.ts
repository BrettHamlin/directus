import type { Response } from 'express';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { ServerService } from '../services/server.js';
import { createMockRequest, createMockResponse, getRouteHandler } from '../test-utils/controllers.js';
import { default as router } from './server.js';

vi.mock('../../src/database/index.js', async () => {
	const { mockDatabase } = await import('../test-utils/database.js');

	return {
		...mockDatabase(),
		hasDatabaseConnection: vi.fn().mockResolvedValue(true),
	};
});

vi.mock('../server.js', () => ({
	SERVER_ONLINE: true,
}));

type HealthStatus = 'ok' | 'warn' | 'error';

type MockResponse = Omit<Response, 'setHeader' | 'status'> & {
	setHeader: Mock;
	status: Mock;
	statusCode: number;
};

const adminAccountability = createDefaultAccountability({
	user: 'admin-user',
	role: 'admin-role',
	roles: ['admin-role'],
	admin: true,
});

const userAccountability = createDefaultAccountability({
	user: 'regular-user',
	role: 'regular-role',
	roles: ['regular-role'],
	admin: false,
});

function createHealthData(status: HealthStatus) {
	return {
		status,
		releaseId: '11.1.0',
		serviceId: 'https://directus.example',
		checks: {
			'postgres:responseTime': [
				{
					status,
					componentType: 'datastore',
					observedUnit: 'ms',
					observedValue: status === 'warn' ? 175 : 25,
					threshold: 150,
				},
			],
		},
	};
}

function createHealthResponse(events: string[] = []) {
	const locals = new Proxy<Record<string, unknown>>(
		{},
		{
			set(target, property, value) {
				events.push(`locals:${String(property)}`);
				target[property as string] = value;
				return true;
			},
		},
	);

	const response = createMockResponse({ locals, statusCode: 200 } as Partial<Response>) as MockResponse;

	response.setHeader = vi.fn((header: string) => {
		events.push(`setHeader:${header}`);
	});

	response.status = vi.fn((statusCode: number) => {
		response.statusCode = statusCode;
		return response;
	});

	return response;
}

async function callHealthHandler(data: Record<string, unknown>, response = createHealthResponse()) {
	vi.spyOn(ServerService.prototype, 'health').mockResolvedValueOnce(data);

	const request = createMockRequest({
		accountability: adminAccountability,
	});

	const next = vi.fn();
	const [handler] = getRouteHandler(router, 'GET', '/health');

	await handler?.handle(request, response, next);

	return { next, response };
}

describe('server controller', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	describe('GET /health', () => {
		//harness:criterion=c-health-header-ok,c-health-header-warn,c-health-header-error,c-health-header-value-exact,c-health-status-code-200-preserved,c-health-status-code-503-preserved,c-health-content-type-preserved
		test.each(['ok', 'warn', 'error'] as const)(
			'sets the exact health status header and preserves status handling for %s',
			async (status) => {
				const data = createHealthData(status);
				const { response } = await callHealthHandler(data);

				const healthHeaderCalls = response.setHeader.mock.calls.filter(
					([header]) => header === 'X-Directus-Health-Status',
				);

				expect(healthHeaderCalls).toEqual([['X-Directus-Health-Status', status]]);

				const contentTypeHeaderCalls = response.setHeader.mock.calls.filter(([header]) => header === 'Content-Type');
				expect(contentTypeHeaderCalls).toEqual([['Content-Type', 'application/health+json']]);

				if (status === 'error') {
					expect(response.status).toHaveBeenCalledTimes(1);
					expect(response.status).toHaveBeenCalledWith(503);
					expect(response.statusCode).toBe(503);
				} else {
					expect(response.status).not.toHaveBeenCalled();
					expect(response.statusCode).toBe(200);
				}
			},
		);

		//harness:criterion=c-health-body-admin-preserved,c-health-no-new-fields-in-body
		test('preserves the full health payload for admin callers', async () => {
			const data = createHealthData('ok');
			const { response } = await callHealthHandler(data);

			expect(response.locals['payload']).toEqual(data);
			expect(Object.keys(response.locals['payload'] as Record<string, unknown>)).toEqual(Object.keys(data));
		});

		//harness:criterion=c-health-body-nonadmin-redacted,c-health-no-new-fields-in-body
		test('preserves the redacted health payload for non-admin callers', async () => {
			const data = createHealthData('ok');

			vi.spyOn(ServerService.prototype, 'health').mockImplementationOnce(function (this: ServerService) {
				return Promise.resolve(this.accountability?.admin === true ? data : { status: data.status });
			});

			const request = createMockRequest({
				accountability: userAccountability,
			});

			const response = createHealthResponse();
			const next = vi.fn();
			const [handler] = getRouteHandler(router, 'GET', '/health');

			await handler?.handle(request, response, next);

			expect(response.locals['payload']).toEqual({ status: 'ok' });
			expect(Object.keys(response.locals['payload'] as Record<string, unknown>)).toEqual(['status']);
		});

		//harness:criterion=c-health-header-set-before-payload
		test('sets the health status header before assigning the payload', async () => {
			const data = createHealthData('ok');
			const events: string[] = [];
			const response = createHealthResponse(events);

			await callHealthHandler(data, response);

			const healthHeaderIndex = events.indexOf('setHeader:X-Directus-Health-Status');
			const payloadIndex = events.indexOf('locals:payload');

			expect(healthHeaderIndex).toBeGreaterThanOrEqual(0);
			expect(payloadIndex).toBeGreaterThanOrEqual(0);
			expect(healthHeaderIndex).toBeLessThan(payloadIndex);
		});
	});
});
