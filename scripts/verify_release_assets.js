'use strict'

const AdmZip = require('adm-zip')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const { HeliosDistribution } = require('helios-core/common')
const BrandConfig = require('../app/assets/js/brandconfig')
const {
    EXPECTED_MOD_SHA256,
    MOD_ID,
    getArgumentValue
} = require('./build_release_assets')

const projectRoot = path.resolve(__dirname, '..')
const releaseDirectory = path.join(projectRoot, 'release')
const distributionPath = path.join(releaseDirectory, 'distribution.json')
const rootDistributionPath = path.join(projectRoot, 'distribution.json')
const distribution = fs.readJsonSync(distributionPath)
const expectedReleaseTag = `${BrandConfig.releaseTagPrefix}${distribution.version}`
const expectedReleasePrefix = `${BrandConfig.githubRepository}/releases/download/${expectedReleaseTag}/`

assert.deepEqual(fs.readJsonSync(rootDistributionPath), distribution)
assert.equal(distribution.servers.length, 1)

const parsed = new HeliosDistribution(
    distribution,
    path.join(projectRoot, 'tmp', 'verify-common'),
    path.join(projectRoot, 'tmp', 'verify-instances')
)
const server = parsed.getServerById(BrandConfig.instanceId)
assert.ok(server)
assert.equal(server.rawServer.name, BrandConfig.serverName)
assert.equal(server.rawServer.address, BrandConfig.serverAddress)
assert.equal(server.rawServer.autoconnect, true)
assert.equal(server.rawServer.mainServer, true)
assert.equal(server.rawServer.minecraftVersion, BrandConfig.minecraftVersion)
assert.equal(server.rawServer.javaOptions.supported, '>=17 <18')
assert.equal(server.rawServer.javaOptions.suggestedMajor, 17)

const forgeModules = server.modules.filter(module => module.rawModule.type === 'ForgeHosted')
const modModules = server.modules.filter(module => module.rawModule.type === 'ForgeMod')
assert.equal(forgeModules.length, 1)
assert.equal(modModules.length, 1)
assert.equal(modModules[0].rawModule.id, MOD_ID)
assert.deepEqual(modModules[0].rawModule.required, { value: true, def: true })
assert.equal(
    modModules[0].getPath().endsWith(path.join('modstore', 'kr', 'phans', 'blacksmith', 'armourersworkshop', '2.1.4', 'armourersworkshop-2.1.4.jar')),
    true
)
assert.equal(server.modules.some(module => /Fabric/i.test(module.rawModule.type)), false)

const forgeModule = forgeModules[0]
assert.equal(
    forgeModule.rawModule.id,
    `net.minecraftforge:forge:${BrandConfig.minecraftVersion}-${BrandConfig.forgeVersion}`
)
const versionManifestModule = forgeModule.subModules.find(module => module.rawModule.type === 'VersionManifest')
assert.ok(versionManifestModule)
assert.equal(versionManifestModule.rawModule.id, BrandConfig.forgeProfile)

const flattenedModules = flattenModules(server.modules)
const seenAssets = new Set()
for(const module of flattenedModules) {
    const artifact = module.rawModule.artifact
    assert.ok(artifact.url.startsWith(expectedReleasePrefix), `Unexpected release URL: ${artifact.url}`)
    assert.equal(artifact.url.includes('/releases/latest/'), false)
    const assetName = decodeURIComponent(new URL(artifact.url).pathname.split('/').pop())
    const localAsset = path.join(releaseDirectory, assetName)
    assert.equal(fs.existsSync(localAsset), true, `Missing release asset ${assetName}`)
    assert.equal(fs.statSync(localAsset).size, artifact.size, `Size mismatch for ${assetName}`)
    assert.equal(hashFile(localAsset, 'md5'), artifact.MD5.toLowerCase(), `MD5 mismatch for ${assetName}`)
    assert.equal(hashFile(localAsset, 'sha1'), artifact.hash.toLowerCase(), `SHA-1 mismatch for ${assetName}`)
    seenAssets.add(assetName)
}

const versionAssetName = decodeURIComponent(new URL(versionManifestModule.rawModule.artifact.url).pathname.split('/').pop())
const versionManifest = fs.readJsonSync(path.join(releaseDirectory, versionAssetName))
assert.equal(versionManifest.id, BrandConfig.forgeProfile)
assert.equal(versionManifest.inheritsFrom, BrandConfig.minecraftVersion)
assert.equal(getArgumentValue(versionManifest.arguments.game, '--fml.forgeVersion'), BrandConfig.forgeVersion)
const mcpVersion = getArgumentValue(versionManifest.arguments.game, '--fml.mcpVersion')

const requiredGeneratedModules = [
    `net.minecraftforge:forge:${BrandConfig.minecraftVersion}-${BrandConfig.forgeVersion}:universal`,
    `net.minecraftforge:forge:${BrandConfig.minecraftVersion}-${BrandConfig.forgeVersion}:client`,
    `net.minecraft:client:${BrandConfig.minecraftVersion}-${mcpVersion}:srg`,
    `net.minecraft:client:${BrandConfig.minecraftVersion}-${mcpVersion}:extra`
]
const forgeSubmoduleIds = new Set(forgeModule.subModules.map(module => module.rawModule.id))
for(const id of requiredGeneratedModules) {
    assert.equal(forgeSubmoduleIds.has(id), true, `Missing generated Forge runtime module ${id}`)
}

const modAssetName = decodeURIComponent(new URL(modModules[0].rawModule.artifact.url).pathname.split('/').pop())
const modPath = path.join(releaseDirectory, modAssetName)
assert.equal(hashFile(modPath, 'sha256'), EXPECTED_MOD_SHA256)
const modMetadata = new AdmZip(modPath).readAsText('META-INF/mods.toml')
assert.match(modMetadata, /modId\s*=\s*"armourers_workshop"/)
assert.match(modMetadata, /version\s*=\s*"2\.1\.4"/)

const distributionText = fs.readFileSync(distributionPath, 'utf8')
assert.equal(/Fabric|fabric-loader|ROW|Complementary/.test(distributionText), false)
assert.equal(server.rawServer.icon, `${BrandConfig.githubRepository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/blacksmith/app/assets/images/icon.png`)

const releaseFiles = fs.readdirSync(releaseDirectory)
const unreferencedAssets = releaseFiles.filter(file => file !== 'distribution.json' && !seenAssets.has(file))
assert.deepEqual(unreferencedAssets, [])

process.stdout.write(`${JSON.stringify({
    server: server.rawServer.name,
    address: server.rawServer.address,
    releaseTag: expectedReleaseTag,
    forgeVersion: BrandConfig.forgeVersion,
    forgeLibraries: forgeModule.subModules.filter(module => module.rawModule.type === 'Library').length,
    mods: modModules.length,
    releaseAssets: releaseFiles.length
}, null, 2)}\n`)

function flattenModules(modules) {
    const result = []
    for(const module of modules) {
        result.push(module)
        result.push(...flattenModules(module.subModules))
    }
    return result
}

function hashFile(filePath, algorithm) {
    return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex')
}
