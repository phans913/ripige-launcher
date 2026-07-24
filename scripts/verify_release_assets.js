'use strict'

const AdmZip = require('adm-zip')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const { HeliosDistribution } = require('helios-core/common')
const BrandConfig = require('../app/assets/js/brandconfig')
const BundleManager = require('../app/assets/js/bundlemanager')

const args = parseArguments(process.argv.slice(2))
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
const shaderPackFiles = manifest.files.filter(file =>
    file.path.startsWith(`instances/${BrandConfig.instanceId}/shaderpacks/`)
)
const managedMods = manifest.files.filter(file => file.path.startsWith('common/mods/fabric/'))
assert.ok(resourcePackFiles.length > 0)
assert.equal(managedMods.length, 3)
assert.equal(resourcePackFiles.some(file => file.path.endsWith('.zip')), false)
assert.deepEqual(shaderPackFiles.map(file => path.posix.basename(file.path)), [BrandConfig.managedShaderPack])

if(args['resource-pack']) {
    verifyResourcePackSource(path.resolve(args['resource-pack']), resourcePackFiles)
}

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
    shaderPacks: shaderPackFiles.length,
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

function parseArguments(argv) {
    argv = argv.filter(argument => argument !== '--')
    const parsed = {}
    for(let i = 0; i < argv.length; i += 2) {
        const key = argv[i]
        const value = argv[i + 1]
        if(!key?.startsWith('--') || value == null) {
            throw new Error(`Invalid argument sequence near ${key || '<empty>'}`)
        }
        parsed[key.slice(2)] = value
    }
    return parsed
}

function verifyResourcePackSource(sourceDirectory, manifestFiles) {
    assert.equal(fs.statSync(sourceDirectory).isDirectory(), true)
    const prefix = `instances/${BrandConfig.instanceId}/resourcepacks/${BrandConfig.managedResourcePack}/`
    const manifestByPath = new Map(manifestFiles.map(file => [file.path.slice(prefix.length), file]))
    const sourceFiles = listFilesRecursive(sourceDirectory)
    assert.equal(manifestByPath.size, sourceFiles.length)

    for(const sourcePath of sourceFiles) {
        const relativePath = normalizePath(path.relative(sourceDirectory, sourcePath))
        const descriptor = manifestByPath.get(relativePath)
        assert.ok(descriptor, `Resource pack manifest entry is missing: ${relativePath}`)
        assert.equal(descriptor.size, fs.statSync(sourcePath).size, `Resource pack size differs: ${relativePath}`)
        assert.equal(descriptor.sha256, hashFile(sourcePath, 'sha256'), `Resource pack hash differs: ${relativePath}`)
    }
}

function listFilesRecursive(directory) {
    const files = []
    for(const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if(entry.isDirectory()) {
            files.push(...listFilesRecursive(entryPath))
        } else if(entry.isFile()) {
            files.push(entryPath)
        }
    }
    return files
}

function normalizePath(value) {
    return value.split(path.sep).join('/')
}
