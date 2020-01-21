const core = require('@actions/core');
const { exportSecrets } = require('./action');

(async () => {
    try {
        await core.group('Get Vault Secrets (experimental)', exportSecrets);
    } catch (error) {
        core.setFailed(error.message);
    }
})();
