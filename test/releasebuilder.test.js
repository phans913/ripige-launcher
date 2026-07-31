'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const BrandConfig = require('../app/assets/js/brandconfig')
const {
    parseArguments,
    parseMavenIdentifier,
    validateForgeVersionManifest
} = require('../scripts/build_release_assets')

test('blacksmith identity and remote distribution are isolated from Ripige data', () => {
    assert.equal(BrandConfig.appName, '대장장이 런처')
    assert.equal(BrandConfig.appDataDirectoryName, '.Blacksmith_Launcher_Data')
    assert.equal(BrandConfig.gameDataDirectoryName, '.Blacksmith')
    assert.equal(BrandConfig.instanceId, 'blacksmith')
    assert.equal(BrandConfig.serverAddress, 'phans.p-e.kr:25565')
    assert.equal(BrandConfig.forgeVersion, '47.4.10')
    assert.equal(BrandConfig.releaseTagPrefix, 'blacksmith-v')
    assert.match(BrandConfig.remoteDistributionUrl, /\/blacksmith\/distribution\.json$/)
})

test('release arguments accept pnpm separators and preserve explicit paths', () => {
    assert.deepEqual(
        parseArguments([
            '--',
            '--minecraft-install', 'C:\\Minecraft Install',
            '--forge-profile', 'forge-47.4.10',
            '--mod', 'C:\\mods\\armourersworkshop.jar',
            '--version', '1.0.0'
        ]),
        {
            'minecraft-install': 'C:\\Minecraft Install',
            'forge-profile': 'forge-47.4.10',
            mod: 'C:\\mods\\armourersworkshop.jar',
            version: '1.0.0'
        }
    )
})

test('Maven identifiers resolve classifiers and extensions without ambiguity', () => {
    assert.deepEqual(
        parseMavenIdentifier('net.minecraftforge:forge:1.20.1-47.4.10:client'),
        {
            group: 'net.minecraftforge',
            artifact: 'forge',
            version: '1.20.1-47.4.10',
            classifier: 'client',
            extension: 'jar'
        }
    )
    assert.deepEqual(
        parseMavenIdentifier('example.group:artifact:1.0:mappings@txt'),
        {
            group: 'example.group',
            artifact: 'artifact',
            version: '1.0',
            classifier: 'mappings',
            extension: 'txt'
        }
    )
    assert.throws(() => parseMavenIdentifier('not-a-coordinate'))
})

test('Forge profile validation rejects a wrong loader shape', () => {
    const valid = {
        id: BrandConfig.forgeProfile,
        inheritsFrom: BrandConfig.minecraftVersion,
        mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
        arguments: {
            game: ['--fml.forgeVersion', BrandConfig.forgeVersion],
            jvm: []
        },
        libraries: [{ name: 'example:library:1.0' }]
    }
    assert.doesNotThrow(() => validateForgeVersionManifest(valid, BrandConfig.forgeProfile))
    assert.throws(() => validateForgeVersionManifest({
        ...valid,
        inheritsFrom: '1.20.2'
    }, BrandConfig.forgeProfile))
})
