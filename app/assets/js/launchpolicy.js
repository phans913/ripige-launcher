'use strict'

function createAutoConnectArguments({ enabled, serverAutoconnect, minecraftVersion, hostname, port }) {
    if(!enabled || !serverAutoconnect) {
        return []
    }

    const [major, minor] = String(minecraftVersion).split('.').map(value => Number.parseInt(value))
    if(major > 1 || (major === 1 && minor >= 20)) {
        return ['--quickPlayMultiplayer', `${hostname}:${port}`]
    }
    return ['--server', hostname, '--port', String(port)]
}

module.exports = {
    createAutoConnectArguments
}
