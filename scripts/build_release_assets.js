'use strict'

const AdmZip = require('adm-zip')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const BrandConfig = require('../app/assets/js/brandconfig')

const REPOSITORY = 'phans913/ripige-launcher'
const MOD_FILES = [
    {
        file: 'fabric-api-0.92.11+1.20.1.jar',
        id: 'ripige.mods:fabric-api:0.92.11-1.20.1',
        name: 'Fabric API 0.92.11'
    },
    {
        file: 'iris-1.7.6+mc1.20.1.jar',
        id: 'ripige.mods:iris:1.7.6-1.20.1',
        name: 'Iris 1.7.6'
    },
    {
        file: 'sodium-fabric-0.5.13+mc1.20.1.jar',
        id: 'ripige.mods:sodium:0.5.13-1.20.1',
        name: 'Sodium 0.5.13'
    }
]

function main() {
    const args = parseArguments(process.argv.slice(2))
    const projectRoot = path.resolve(__dirname, '..')
    const instanceDirectory = path.resolve(requireArgument(args, 'instance'))
    const minecraftInstall = path.resolve(requireArgument(args, 'minecraft-install'))
    const packVersion = requireArgument(args, 'version')
    if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packVersion)) {
        throw new Error(`Invalid --version: ${packVersion}`)
    }

    const instanceMetadata = fs.readJsonSync(path.join(instanceDirectory, 'minecraftinstance.json'))
    if(instanceMetadata.gameVersion !== BrandConfig.minecraftVersion
        || instanceMetadata.baseModLoader?.forgeVersion !== BrandConfig.fabricLoaderVersion
        || instanceMetadata.baseModLoader?.type !== 4) {
        throw new Error('The selected instance is not the required Minecraft 1.20.1 / Fabric Loader 0.19.3 instance.')
    }

    const resourcePackDirectory = path.join(instanceDirectory, 'resourcepacks', BrandConfig.managedResourcePack)
    if(!fs.statSync(resourcePackDirectory).isDirectory()) {
        throw new Error(`Managed resource pack directory is missing: ${resourcePackDirectory}`)
    }
    const shaderPackPath = path.join(instanceDirectory, 'shaderpacks', BrandConfig.managedShaderPack)
    assertFile(shaderPackPath)

    const loaderId = `fabric-loader-${BrandConfig.fabricLoaderVersion}-${BrandConfig.minecraftVersion}`
    const loaderJar = path.join(
        minecraftInstall,
        'libraries',
        'net',
        'fabricmc',
        'fabric-loader',
        BrandConfig.fabricLoaderVersion,
        `fabric-loader-${BrandConfig.fabricLoaderVersion}.jar`
    )
    const loaderVersionJson = path.join(minecraftInstall, 'versions', loaderId, `${loaderId}.json`)
    assertFile(loaderJar)
    assertFile(loaderVersionJson)

    const versionManifest = fs.readJsonSync(loaderVersionJson)
    if(versionManifest.id !== loaderId || versionManifest.inheritsFrom !== BrandConfig.minecraftVersion) {
        throw new Error('Fabric version manifest does not match the requested loader.')
    }

    const releaseDirectory = path.join(projectRoot, 'release')
    fs.emptyDirSync(releaseDirectory)
    const releaseBaseUrl = `https://github.com/${REPOSITORY}/releases/latest/download`

    const loaderAsset = copyReleaseAsset(loaderJar, releaseDirectory, releaseBaseUrl)
    const versionAsset = copyReleaseAsset(loaderVersionJson, releaseDirectory, releaseBaseUrl)
    const libraryModules = []
    const copiedLibraryFiles = new Set()

    for(const library of versionManifest.libraries) {
        if(library.name === `net.fabricmc:fabric-loader:${BrandConfig.fabricLoaderVersion}`) {
            continue
        }
        const libraryPath = resolveMavenLibraryPath(minecraftInstall, library.name)
        assertFile(libraryPath)
        const asset = copyReleaseAsset(libraryPath, releaseDirectory, releaseBaseUrl)
        copiedLibraryFiles.add(asset.file)
        libraryModules.push({
            id: library.name,
            name: library.name,
            type: 'Library',
            artifact: artifactForDistribution(asset)
        })
    }

    const zip = new AdmZip()
    const managedFiles = []
    const modModules = []

    for(const mod of MOD_FILES) {
        const sourcePath = path.join(instanceDirectory, 'mods', mod.file)
        assertFile(sourcePath)
        const releaseAsset = copyReleaseAsset(sourcePath, releaseDirectory, releaseBaseUrl)
        const archivePath = `common/mods/fabric/${mod.file}`
        addManagedFile(zip, sourcePath, archivePath, managedFiles)
        modModules.push({
            id: mod.id,
            name: mod.name,
            type: 'FabricMod',
            required: { value: true, def: true },
            artifact: {
                ...artifactForDistribution(releaseAsset),
                path: mod.file
            }
        })
    }

    const resourcePackFiles = listFilesRecursive(resourcePackDirectory)
    for(const sourcePath of resourcePackFiles) {
        const relativePath = normalizePath(path.relative(resourcePackDirectory, sourcePath))
        const archivePath = `instances/${BrandConfig.instanceId}/resourcepacks/${BrandConfig.managedResourcePack}/${relativePath}`
        addManagedFile(zip, sourcePath, archivePath, managedFiles)
    }
    addManagedFile(
        zip,
        shaderPackPath,
        `instances/${BrandConfig.instanceId}/shaderpacks/${BrandConfig.managedShaderPack}`,
        managedFiles
    )

    const bundleName = 'ripige-modpack-bundle.zip'
    const bundlePath = path.join(releaseDirectory, bundleName)
    zip.writeZip(bundlePath)
    const bundleStats = fs.statSync(bundlePath)
    const bundleManifest = {
        schemaVersion: 1,
        packVersion,
        minecraftVersion: BrandConfig.minecraftVersion,
        fabricLoaderVersion: BrandConfig.fabricLoaderVersion,
        bundle: {
            url: `${releaseBaseUrl}/${bundleName}`,
            size: bundleStats.size,
            sha256: hashFile(bundlePath, 'sha256')
        },
        files: managedFiles.sort((a, b) => a.path.localeCompare(b.path))
    }

    const distribution = {
        version: packVersion,
        servers: [
            {
                id: BrandConfig.instanceId,
                name: BrandConfig.serverName,
                description: 'Minecraft 1.20.1 / Fabric',
                icon: `https://raw.githubusercontent.com/${REPOSITORY}/main/app/assets/images/icon.png`,
                version: packVersion,
                address: BrandConfig.serverAddress,
                minecraftVersion: BrandConfig.minecraftVersion,
                mainServer: true,
                autoconnect: true,
                javaOptions: {
                    supported: '>=17 <18',
                    suggestedMajor: 17,
                    distribution: 'TEMURIN',
                    ram: {
                        recommended: 4096,
                        minimum: 2048
                    }
                },
                modules: [
                    {
                        id: `net.fabricmc:fabric-loader:${BrandConfig.fabricLoaderVersion}`,
                        name: `Fabric Loader ${BrandConfig.fabricLoaderVersion}`,
                        type: 'Fabric',
                        artifact: artifactForDistribution(loaderAsset),
                        subModules: [
                            {
                                id: loaderId,
                                name: `${loaderId} version manifest`,
                                type: 'VersionManifest',
                                artifact: artifactForDistribution(versionAsset)
                            },
                            ...libraryModules
                        ]
                    },
                    ...modModules
                ]
            }
        ]
    }

    const distributionText = `${JSON.stringify(distribution, null, 2)}\n`
    const bundleManifestText = `${JSON.stringify(bundleManifest, null, 2)}\n`
    fs.writeFileSync(path.join(releaseDirectory, 'distribution.json'), distributionText, 'utf8')
    fs.writeFileSync(path.join(releaseDirectory, 'bundle-manifest.json'), bundleManifestText, 'utf8')
    fs.writeFileSync(path.join(projectRoot, 'distribution.json'), distributionText, 'utf8')

    const summary = {
        packVersion,
        mods: MOD_FILES.length,
        fabricLibraries: copiedLibraryFiles.size,
        resourcePackFiles: resourcePackFiles.length,
        shaderPacks: 1,
        managedFiles: managedFiles.length,
        bundleBytes: bundleStats.size,
        releaseDirectory
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
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

function requireArgument(args, name) {
    if(!args[name]) {
        throw new Error(`Missing required argument --${name}`)
    }
    return args[name]
}

function resolveMavenLibraryPath(minecraftInstall, coordinate) {
    const parts = coordinate.split(':')
    if(parts.length !== 3) {
        throw new Error(`Unsupported Maven coordinate: ${coordinate}`)
    }
    const [group, artifact, version] = parts
    return path.join(
        minecraftInstall,
        'libraries',
        ...group.split('.'),
        artifact,
        version,
        `${artifact}-${version}.jar`
    )
}

function copyReleaseAsset(sourcePath, releaseDirectory, releaseBaseUrl) {
    const file = path.basename(sourcePath)
    const destination = path.join(releaseDirectory, file)
    if(!fs.existsSync(destination)) {
        fs.copyFileSync(sourcePath, destination)
    } else if(hashFile(destination, 'sha256') !== hashFile(sourcePath, 'sha256')) {
        throw new Error(`Release asset filename collision: ${file}`)
    }
    const stats = fs.statSync(destination)
    return {
        file,
        path: destination,
        url: `${releaseBaseUrl}/${encodeURIComponent(file)}`,
        size: stats.size,
        md5: hashFile(destination, 'md5'),
        sha1: hashFile(destination, 'sha1'),
        sha256: hashFile(destination, 'sha256')
    }
}

function artifactForDistribution(asset) {
    return {
        size: asset.size,
        MD5: asset.md5,
        hash: asset.sha1,
        url: asset.url
    }
}

function addManagedFile(zip, sourcePath, archivePath, managedFiles) {
    const normalized = normalizePath(archivePath)
    const data = fs.readFileSync(sourcePath)
    zip.addFile(normalized, data)
    managedFiles.push({
        path: normalized,
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex')
    })
}

function listFilesRecursive(root) {
    const files = []
    for(const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(root, entry.name)
        if(entry.isDirectory()) {
            files.push(...listFilesRecursive(entryPath))
        } else if(entry.isFile()) {
            files.push(entryPath)
        }
    }
    return files
}

function hashFile(filePath, algorithm) {
    return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex')
}

function normalizePath(value) {
    return value.split(path.sep).join('/')
}

function assertFile(filePath) {
    if(!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Required file is missing: ${filePath}`)
    }
}

if(require.main === module) {
    try {
        main()
    } catch(error) {
        process.stderr.write(`${error.stack || error.message}\n`)
        process.exitCode = 1
    }
}

module.exports = {
    MOD_FILES,
    artifactForDistribution,
    listFilesRecursive,
    parseArguments,
    resolveMavenLibraryPath
}
