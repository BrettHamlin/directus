import type { SchemaOverview } from '@directus/types';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { ServerService } from '../services/server.js';
import { createMockRequest, createMockResponse, getRouteHandler } from '../test-utils/controllers.js';
import router from './server.js';

const { env } = vi.hoisted(() => ({
	env: {
		CACHE_ENABLED: false,
		CACHE_VALUE_MAX_SIZE: false,
		DB_CLIENT: 'postgres',
		GRAPHQL_INTROSPECTION: false,
		OPENAPI_ENABLED: false,
		PUBLIC_URL: 'http://localhost',
		RATE_LIMITER_ENABLED: false,
		RATE_LIMITER_GLOBAL_ENABLED: false,
		STORAGE_LOCATIONS: [],
	},
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue(env),
}));

vi.mock('../cache.js', () => ({
	getCache: vi.fn().mockReturnValue({ cache: null, systemCache: null, lockCache: null }),
	setCacheValue: vi.fn(),
}));

vi.mock('../database/index.js', () => ({
	default: vi.fn().mockReturnValue({
		client: {
			pool: {
				numFree: vi.fn().mockReturnValue(1),
				numUsed: vi.fn().mockReturnValue(0),
			},
		},
	}),
	hasDatabaseConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock('../logger/index.js', () => ({
	useLogger: vi.fn().mockReturnValue({
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock('../mailer.js', () => ({
	default: vi.fn().mockReturnValue({
		verify: vi.fn().mockResolvedValue(true),
	}),
}));

vi.mock('../middleware/rate-limiter-global.js', () => ({
	rateLimiterGlobal: {
		consume: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock('../middleware/rate-limiter-ip.js', () => ({
	rateLimiter: {
		consume: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock('../server.js', () => ({
	SERVER_ONLINE: true,
}));

vi.mock('../services/index.js', () => ({
	SettingsService: vi.fn(),
}));

vi.mock('../services/settings.js', () => ({
	SettingsService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../services/specifications.js', () => ({
	SpecificationService: vi.fn(),
}));

vi.mock('../storage/index.js', () => ({
	getStorage: vi.fn().mockResolvedValue({
		location: vi.fn().mockReturnValue({
			write: vi.fn().mockResolvedValue(undefined),
		}),
	}),
}));

vi.mock('../utils/create-admin.js', () => ({
	createAdmin: vi.fn(),
}));

vi.mock('../utils/permissions-cacheable.js', () => ({
	permissionsCacheable: vi.fn().mockResolvedValue(false),
}));

const schema = {
	collections: {},
	relations: [],
} as unknown as SchemaOverview;

const nonAdminAccountability = createDefaultAccountability({
	user: 'user-1',
	role: 'role-1',
	roles: ['role-1'],
	admin: false,
});

const adminAccountability = createDefaultAccountability({
	user: 'admin-1',
	role: 'admin-role',
	roles: ['admin-role'],
	admin: true,
});

async function requestHealth({
	accountability = nonAdminAccountability,
	include,
}: {
	accountability?: typeof nonAdminAccountability;
	include?: string;
} = {}) {
	const [healthHandler, respondHandler] = getRouteHandler(router, 'GET', '/health');
	const url = include ? `/server/health?include=${include}` : '/server/health';
	const res = createMockResponse({ setHeader: vi.fn() });
	const next = vi.fn();

	const req = createMockRequest({
		accountability,
		method: 'GET',
		originalUrl: url,
		query: include ? { include } : {},
		sanitizedQuery: {},
		schema,
		url,
	});

	await healthHandler?.handle(req, res, next);

	expect(next).toHaveBeenCalledWith();

	await respondHandler?.handle(req, res, next);

	return vi.mocked(res.json).mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function expectIsoTimestamp(value: unknown) {
	expect(typeof value).toBe('string');
	expect(Number.isNaN(new Date(value as string).getTime())).toBe(false);
	expect(new Date(value as string).toISOString()).toBe(value);
}

describe('server controller', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /health', () => {
		test('returns only status by default for non-admin callers', async () => {
			//harness:criterion=c-health-default-no-checked-at,c-health-default-status-present,c-health-non-admin-redaction-default
			const payload = await requestHealth();

			expect(payload).toHaveProperty('status');
			expect(payload).not.toHaveProperty('checkedAt');
			expect(Object.keys(payload)).toEqual(['status']);
		});

		test('returns status and checkedAt when non-admin callers opt into timestamp', async () => {
			//harness:criterion=c-health-include-timestamp-non-admin-checked-at,c-health-non-admin-redaction-with-timestamp
			const payload = await requestHealth({ include: 'timestamp' });

			expect(payload).toHaveProperty('checkedAt');
			expectIsoTimestamp(payload['checkedAt']);
			expect(Object.keys(payload).sort()).toEqual(['checkedAt', 'status']);
		});

		test('returns admin health details without checkedAt by default', async () => {
			//harness:criterion=c-health-admin-full-data-default
			const payload = await requestHealth({ accountability: adminAccountability });

			expect(Object.keys(payload).length).toBeGreaterThan(1);
			expect(payload).toHaveProperty('checks');
			expect(payload).not.toHaveProperty('checkedAt');
		});

		test('returns checkedAt with existing admin health details when admins opt into timestamp', async () => {
			//harness:criterion=c-health-include-timestamp-admin-checked-at,c-health-admin-full-data-with-timestamp
			const defaultPayload = await requestHealth({ accountability: adminAccountability });
			const payload = await requestHealth({ accountability: adminAccountability, include: 'timestamp' });

			expect(payload).toHaveProperty('checkedAt');
			expectIsoTimestamp(payload['checkedAt']);
			expect(Object.keys(defaultPayload).every((key) => key in payload)).toBe(true);
		});

		test('does not include checkedAt for unrecognized include values', async () => {
			//harness:criterion=c-health-unknown-include-value-no-checked-at
			const payload = await requestHealth({ include: 'somethingelse' });

			expect(payload).not.toHaveProperty('checkedAt');
		});

		test('records checkedAt during the request lifecycle', async () => {
			//harness:criterion=c-health-checked-at-reflects-check-time
			const beforeTime = Date.now();
			const payload = await requestHealth({ include: 'timestamp' });
			const afterTime = Date.now();
			const checkedAt = new Date(payload['checkedAt'] as string).getTime();

			expect(checkedAt).toBeGreaterThanOrEqual(beforeTime);
			expect(checkedAt).toBeLessThanOrEqual(afterTime);
		});
	});
});

describe('ServerService.health', () => {
	test('does not include checkedAt when called without the timestamp option', async () => {
		//harness:criterion=c-health-graphql-resolver-no-checked-at
		const service = new ServerService({ accountability: adminAccountability, schema });

		const result = await service.health();

		expect(result).not.toHaveProperty('checkedAt');
	});
});
