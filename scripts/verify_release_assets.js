'use strict'

const AdmZip = require('adm-zip')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const { HeliosDistribution } = require('helios-core/common')
const BrandConfig = require('../app/assets/js/brandconfig')
const BundleManager = require('../app/assets/js/bundlemanager')

const projectRoot = path.resolve(__dirname, '..')
const releaseDirectory = path.join(projectRoot, 'release')
const distribution = fs.readJsonSync(path.join(releaseDirectory, 'distribution.json'))
const manifest = BundleManager.validateManifest(fs.readJsonSync(path.join(releaseDirectory, 'bundle-manifest.json')))
const archive = new AdmZip(path.join(releaseDirectory, 'ripige-modpack-bundle.zip'))

const parsed = new HeliosDistribution(
    distribution,
    path.join(projectRoot, 'tmp', 'verify-common'),
    path.join(projectRoot, 'tmp', 'verify-instances')
)
const server = parsed.getServerById(BrandConfig.instanceId)
assert.ok(server)
assert.equal(server.rawServer.address, BrandConfig.serverAddress)
assert.equal(server.rawServer.autoconnect, true)
assert.equal(server.rawServer.mainServer, true)
assert.equal(server.rawServer.minecraftVersion, BrandConfig.minecraftVersion)
assert.equal(server.modules.filter(module => module.rawModule.type === 'Fabric').length, 1)
assert.equal(server.modules.filter(module => module.rawModule.type === 'FabricMod').length, 3)

const resourcePackFiles = manifest.files.filter(file =>
    file.path.startsWith(`instances/${BrandConfig.instanceId}/resourcepacks/${BrandConfig.managedResourcePack}/`)
)
const managedMods = manifest.files.filter(file => file.path.startsWith('common/mods/fabric/'))
assert.equal(resourcePackFiles.length, 921)
assert.equal(managedMods.length, 3)
assert.equal(manifest.files.some(file => file.path.endsWith('.zip')), false)

const archiveEntries = archive.getEntries().filter(entry => !entry.isDirectory).map(entry => entry.entryName.replace(/\\/g, '/')).sort()
assert.deepEqual(archiveEntries, manifest.files.map(file => file.path).sort())

for(const module of flattenModules(server.modules)) {
    const artifact = module.rawModule.artifact
    const assetName = decodeURIComponent(new URL(artifact.url).pathname.split('/').pop())
    const localAsset = path.join(releaseDirectory, assetName)
    assert.equal(fs.existsSync(localAsset), true, `Missing release asset ${assetName}`)
    assert.equal(fs.statSync(localAsset).size, artifact.size)
    assert.equal(hashFile(localAsset, 'md5'), artifact.MD5)
}

process.stdout.write(`${JSON.stringify({
    server: server.rawServer.name,
    address: server.rawServer.address,
    managedMods: managedMods.length,
    resourcePackFiles: resourcePackFiles.length,
    archiveEntries: archiveEntries.length
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
