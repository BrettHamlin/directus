import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { requestGraphQL } from '@common/transport';
import { TEST_USERS, USER } from '@common/variables';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('/server', () => {
	describe('GET /health', () => {
		let fakeSMTPServer: SMTPServer;

		beforeAll(async () => {
			fakeSMTPServer = new SMTPServer({
				authOptional: true,
				hideSTARTTLS: true,
				onData(_stream, _, cb) {
					cb();
				},
			});

			await new Promise<void>((resolve) =>
				fakeSMTPServer.listen(1025, '127.0.0.1', () => {
					resolve();
				}),
			);
		}, 180_000);

		afterAll(async () => {
			await new Promise<void>((resolve) =>
				fakeSMTPServer.close(() => {
					resolve();
				}),
			);
		});

		TEST_USERS.forEach((userKey) => {
			describe(USER[userKey].NAME, () => {
				//harness:criterion=c-health-header-present-admin,c-health-header-value-matches-status-admin,c-health-body-admin-unchanged,c-health-content-type-preserved,c-health-graphql-resolver-unaffected
				it.each(vendors)('%s', async (vendor) => {
					// Action
					const response = await request(getUrl(vendor))
						.get('/server/health')
						.set('Authorization', `Bearer ${USER[userKey].TOKEN}`);

					const gqlResponse = await requestGraphQL(getUrl(vendor), true, USER[userKey].TOKEN, {
						query: {
							server_health: true,
						},
					});

					// Assert
					expect(response.statusCode).toBe(200);
					expect(gqlResponse.statusCode).toBe(200);
					expect(response.headers['content-type']).toContain('application/health+json');

					if (userKey === USER.ADMIN.KEY) {
						const adminResult = {
							status: expect.stringMatching(/ok|warn/),
							releaseId: expect.any(String),
							serviceId: expect.any(String),
							checks: expect.anything(),
						};

						expect(response.body).toEqual(adminResult);
						expect(response.headers['x-directus-health-status']).toEqual(expect.stringMatching(/^(ok|warn|error)$/));
						expect(gqlResponse.body.data.server_health).toEqual(adminResult);
					} else {
						const nonAdminResult = { status: expect.stringMatching(/ok|warn/) };

						expect(response.body).toEqual(nonAdminResult);
						expect(gqlResponse.body.data.server_health).toEqual(nonAdminResult);
					}
				});
			});
		});

		describe('public', () => {
			//harness:criterion=c-health-header-present-noauth,c-health-header-value-matches-status-noauth,c-health-body-noauth-redacted
			it.each(vendors)('%s', async (vendor) => {
				// Action
				const response = await request(getUrl(vendor)).get('/server/health');

				// Assert
				expect(response.statusCode).toBe(200);
				expect(response.headers['x-directus-health-status']).toEqual(expect.stringMatching(/^(ok|warn|error)$/));
				expect(Object.keys(response.body)).toHaveLength(1);
				expect(response.body).toEqual({ status: expect.stringMatching(/^(ok|warn)$/) });
			});
		});
	});
});
