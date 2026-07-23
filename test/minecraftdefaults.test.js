'use strict'

const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const test = require('node:test')
const BrandConfig = require('../app/assets/js/brandconfig')
const LaunchPolicy = require('../app/assets/js/launchpolicy')
const MinecraftDefaults = require('../app/assets/js/minecraftdefaults')

test('first options file uses vanilla controls and preserves later user changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripige-options-'))
    try {
        assert.equal(MinecraftDefaults.ensureInitialOptions(root), true)
        const optionsPath = path.join(root, 'options.txt')
        const initial = fs.readFileSync(optionsPath, 'utf8')
        assert.match(initial, /^guiScale:3$/m)
        assert.match(initial, /^gamma:1\.0$/m)
        assert.match(initial, new RegExp(`file/${BrandConfig.managedResourcePack}`))
        assert.doesNotMatch(initial, /^key_/m)

        const customized = `${initial}key_key.jump:key.keyboard.r\n`
        fs.writeFileSync(optionsPath, customized, 'utf8')
        assert.equal(MinecraftDefaults.ensureInitialOptions(root), false)
        assert.equal(fs.readFileSync(optionsPath, 'utf8'), customized)
    } finally {
        fs.removeSync(root)
    }
})

test('servers.dat adds 리피지 exactly once and preserves existing entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripige-servers-'))
    try {
        const serversPath = path.join(root, 'servers.dat')
        fs.writeFileSync(serversPath, MinecraftDefaults.createServersDat([
            MinecraftDefaults.createServerCompound('다른 서버', 'example.org:25565')
        ]))
        assert.equal(MinecraftDefaults.ensureServerEntry(root), true)
        const once = fs.readFileSync(serversPath)
        assert.equal(once.includes(Buffer.from('example.org:25565')), true)
        assert.equal(once.includes(Buffer.from(BrandConfig.serverName)), true)
        assert.equal(once.includes(Buffer.from(BrandConfig.serverAddress)), true)
        assert.equal(MinecraftDefaults.findServersList(once).length, 2)

        assert.equal(MinecraftDefaults.ensureServerEntry(root), false)
        assert.deepEqual(fs.readFileSync(serversPath), once)
        assert.equal(MinecraftDefaults.findServersList(once).length, 2)
    } finally {
        fs.removeSync(root)
    }
})

test('auto connect is enabled by default contract but remains user-toggleable', () => {
    const base = {
        serverAutoconnect: true,
        minecraftVersion: BrandConfig.minecraftVersion,
        hostname: 'phans.p-e.kr',
        port: 24454
    }
    assert.deepEqual(
        LaunchPolicy.createAutoConnectArguments({ ...base, enabled: true }),
        ['--quickPlayMultiplayer', BrandConfig.serverAddress]
    )
    assert.deepEqual(
        LaunchPolicy.createAutoConnectArguments({ ...base, enabled: false }),
        []
    )
})

