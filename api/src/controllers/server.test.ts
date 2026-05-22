import type { Accountability } from '@directus/types';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerService } from '../services/server.js';
import { createMockRequest, createMockResponse, getRouteHandler } from '../test-utils/controllers.js';
import { default as router } from './server.js';

vi.mock('../../src/database/index.js', async () => {
	const { mockDatabase } = await import('../test-utils/database.js');
	return mockDatabase();
});

const [healthHandler] = getRouteHandler(router, 'GET', '/health');

async function callHealthHandler({
	payload,
	req,
	res,
}: {
	payload: Awaited<ReturnType<ServerService['health']>>;
	req?: Request;
	res?: Response;
}) {
	const next = vi.fn();

	vi.spyOn(ServerService.prototype, 'health').mockResolvedValue(payload);

	await healthHandler?.handle(req ?? createMockRequest(), res ?? createMockResponse(), next);

	return next;
}

describe('server controller', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('GET /health', () => {
		test.each(['ok', 'warn', 'error'] as const)('sets health headers for %s status', async (status) => {
			//harness:criterion=c-health-header-present-on-ok,c-health-header-present-on-warn,c-health-header-present-on-error,c-health-header-value-exact,c-health-content-type-preserved
			const res = createMockResponse();

			await callHealthHandler({ payload: { status }, res });

			expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/health+json');
			expect(res.setHeader).toHaveBeenCalledWith('X-Directus-Health-Status', status);
		});

		test('sets 503 status for an error health response', async () => {
			//harness:criterion=c-health-503-on-error-status
			const res = createMockResponse();

			await callHealthHandler({ payload: { status: 'error' }, res });

			expect(res.status).toHaveBeenCalledTimes(1);
			expect(res.status).toHaveBeenCalledWith(503);
		});

		test('does not set 503 status for an ok health response', async () => {
			//harness:criterion=c-health-200-on-ok-status
			const res = createMockResponse();

			await callHealthHandler({ payload: { status: 'ok' }, res });

			expect(res.status).not.toHaveBeenCalledWith(503);
		});

		test('preserves the full admin health payload', async () => {
			//harness:criterion=c-health-admin-full-body-preserved
			const payload = {
				status: 'ok',
				releaseId: '1.0.0',
				checks: {
					database: {
						status: 'ok',
					},
				},
			} as const;

			const req = createMockRequest({
				accountability: { admin: true, user: 'admin-user' } as Accountability,
			});

			const res = createMockResponse();

			await callHealthHandler({ payload, req, res });

			expect(res.locals['payload']).toEqual(payload);
		});

		test('preserves the redacted non-admin health payload', async () => {
			//harness:criterion=c-health-non-admin-redacted-body-preserved
			const req = createMockRequest({
				accountability: { admin: false, user: 'regular-user' } as Accountability,
			});

			const res = createMockResponse();

			await callHealthHandler({ payload: { status: 'ok' }, req, res });

			expect(res.locals['payload']).toEqual({ status: 'ok' });
		});

		test('sets the health status header before assigning the response payload', async () => {
			//harness:criterion=c-health-header-set-before-respond-middleware
			const events: string[] = [];
			let payloadValue: unknown;

			const locals = {};

			Object.defineProperty(locals, 'payload', {
				get() {
					return payloadValue;
				},
				set(value) {
					events.push('payload');
					payloadValue = value;
				},
				configurable: true,
			});

			const res = createMockResponse({ locals });

			vi.mocked(res.setHeader).mockImplementation((name: string) => {
				if (name === 'X-Directus-Health-Status') events.push('health-header');
				return res;
			});

			await callHealthHandler({ payload: { status: 'ok' }, res });

			expect(events).toEqual(['health-header', 'payload']);
			expect(res.locals['payload']).toEqual({ status: 'ok' });
		});
	});
});
