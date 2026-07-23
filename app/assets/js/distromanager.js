const { DistributionAPI } = require('helios-core/common')
const fs = require('fs')
const path = require('path')

const ConfigManager = require('./configmanager')

function getRemoteDistributionUrl() {
    const urlConfigPath = path.join(__dirname, '..', 'defaults', 'remote_distribution_url.txt')

    // Keep the release URL in a text asset so deployments do not require code changes.
    if(fs.existsSync(urlConfigPath)) {
        const configuredUrl = fs.readFileSync(urlConfigPath, 'UTF-8').trim()

        if(configuredUrl && !configuredUrl.startsWith('#')) {
            return configuredUrl
        }
    }

    return null
}

exports.REMOTE_DISTRO_URL = getRemoteDistributionUrl()

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL || 'https://github.com/phans913/ripige-launcher/releases/latest/download/distribution.json',
    false
)

let initialDistributionPromise = null

if(exports.REMOTE_DISTRO_URL == null) {
    api.pullRemote = async () => ({ data: null })
}

exports.getInitialDistribution = function() {
    if(initialDistributionPromise == null) {
        initialDistributionPromise = api.getDistribution()
    }
    return initialDistributionPromise
}

exports.DistroAPI = api
