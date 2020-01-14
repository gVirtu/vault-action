jest.mock('@actions/core');
jest.mock('@actions/core/lib/command');
const core = require('@actions/core');

const got = require('got');
const { when } = require('jest-when');

const { exportSecrets } = require('../../action');

const vaultUrl = `http://${process.env.VAULT_HOST || 'localhost'}:${process.env.VAULT_PORT || '8201'}`;

describe('integration', () => {
    beforeAll(async () => {
        // Verify Connection
        await got(`${vaultUrl}/v1/secret/config`, {
            headers: {
                'X-Vault-Token': 'testtoken',
            },
        });

        // Create namespace
        try {
            await got(`${vaultUrl}/v1/sys/namespaces/ns1`, {
                method: 'POST',
                headers: {
                    'X-Vault-Token': 'testtoken',
                },
                json: {},
            });
        } catch (error) {
            const {response} = error;
            if (response.statusCode === 400 && response.body.includes("already exists")) {
                // Namespace might already be enabled from previous test runs
            } else {
                throw error;
            }
        }

        // Enable K/V v2 secret engine at 'secret/'
        await enableEngine("secret", 2);

        await writeSecret('secret', 'test', 2, {secret: 'SUPERSECRET_IN_NAMESPACE'})
        await writeSecret('secret', 'nested/test', 2, {otherSecret: 'OTHERSUPERSECRET_IN_NAMESPACE'})

        // Enable K/V v1 secret engine at 'my-secret/'
        await enableEngine("my-secret", 1);

        await writeSecret('my-secret', 'test', 1, {secret: 'CUSTOMSECRET_IN_NAMESPACE'})
        await writeSecret('my-secret', 'nested/test', 1, {otherSecret: 'OTHERCUSTOMSECRET_IN_NAMESPACE'})
    });

    beforeEach(() => {
        jest.resetAllMocks();

        when(core.getInput)
            .calledWith('url')
            .mockReturnValue(`${vaultUrl}`);

        when(core.getInput)
            .calledWith('token')
            .mockReturnValue('testtoken');

        when(core.getInput)
            .calledWith('namespace')
            .mockReturnValue('ns1');
    });

    async function enableEngine(path, version) {
        // Enable secret engine
        try {
            await got(`${vaultUrl}/v1/sys/mounts/${path}`, {
                method: 'POST',
                headers: {
                    'X-Vault-Token': 'testtoken',
                    'X-Vault-Namespace': 'ns1',
                },
                json: { type: 'kv', config: {}, options: { version }, generate_signing_key: true },
            });
        } catch (error) {
            const {response} = error;
            if (response.statusCode === 400 && response.body.includes("path is already in use")) {
                // Engine might already be enabled from previous test runs
            } else {
                throw error;
            }
        }
    }

    async function writeSecret(engine, path, version, data) {
        const secretPath = (version == 1) ? (`${engine}/${path}`) : (`${engine}/data/${path}`);
        const secretPayload = (version == 1) ? (data) : ({data});
        await got(`${vaultUrl}/v1/${secretPath}`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
                'X-Vault-Namespace': 'ns1',
            },
            json: secretPayload
        });
    }

    function mockInput(secrets) {
        when(core.getInput)
            .calledWith('secrets')
            .mockReturnValue(secrets);
    }

    function mockEngineName(name) {
        when(core.getInput)
            .calledWith('engine-name')
            .mockReturnValue(name);
    }

    function mockVersion(version) {
        when(core.getInput)
            .calledWith('kv-version')
            .mockReturnValue(version);
    }

    it('get simple secret', async () => {
        mockInput('test secret');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('SECRET', 'SUPERSECRET_IN_NAMESPACE');
    });

    it('re-map secret', async () => {
        mockInput('test secret | TEST_KEY');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('TEST_KEY', 'SUPERSECRET_IN_NAMESPACE');
    });

    it('get nested secret', async () => {
        mockInput('nested/test otherSecret');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('OTHERSECRET', 'OTHERSUPERSECRET_IN_NAMESPACE');
    });

    it('get multiple secrets', async () => {
        mockInput(`
        test secret ;
        test secret | NAMED_SECRET ;
        nested/test otherSecret ;`);

        await exportSecrets();

        expect(core.exportVariable).toBeCalledTimes(3);

        expect(core.exportVariable).toBeCalledWith('SECRET', 'SUPERSECRET_IN_NAMESPACE');
        expect(core.exportVariable).toBeCalledWith('NAMED_SECRET', 'SUPERSECRET_IN_NAMESPACE');
        expect(core.exportVariable).toBeCalledWith('OTHERSECRET', 'OTHERSUPERSECRET_IN_NAMESPACE');
    });

    it('get secret from K/V v1', async () => {
        mockInput('test secret');
        mockEngineName('my-secret');
        mockVersion('1');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('SECRET', 'CUSTOMSECRET_IN_NAMESPACE');
    });

    it('get nested secret from K/V v1', async () => {
        mockInput('nested/test otherSecret');
        mockEngineName('my-secret');
        mockVersion('1');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('OTHERSECRET', 'OTHERCUSTOMSECRET_IN_NAMESPACE');
    });
});
