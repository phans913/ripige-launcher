'use strict'

const AdmZip = require('adm-zip')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const BrandConfig = require('../app/assets/js/brandconfig')

const REPOSITORY = 'phans913/ripige-launcher'
const MOD_ID = 'kr.phans.blacksmith:armourersworkshop:2.1.4'
const MOD_NAME = 'Armourer\'s Workshop 2.1.4'
const EXPECTED_MOD_SHA256 = 'af032296c8e8b60f8170bf422fea340c990c0c92a6052ab52214891615664f37'

function main() {
    const args = parseArguments(process.argv.slice(2))
    const projectRoot = path.resolve(__dirname, '..')
    const minecraftInstall = path.resolve(requireArgument(args, 'minecraft-install'))
    const forgeProfile = args['forge-profile'] || BrandConfig.forgeProfile
    const modPath = path.resolve(requireArgument(args, 'mod'))
    const packVersion = requireArgument(args, 'version')

    if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packVersion)) {
        throw new Error(`Invalid --version: ${packVersion}`)
    }
    if(forgeProfile !== BrandConfig.forgeProfile) {
        throw new Error(`Forge profile must be ${BrandConfig.forgeProfile}, received ${forgeProfile}`)
    }

    const versionManifestPath = path.join(
        minecraftInstall,
        'versions',
        forgeProfile,
        `${forgeProfile}.json`
    )
    assertFile(versionManifestPath)
    const versionManifest = fs.readJsonSync(versionManifestPath)
    validateForgeVersionManifest(versionManifest, forgeProfile)
    validateArmourersWorkshop(modPath)

    const forgeVersion = getArgumentValue(versionManifest.arguments.game, '--fml.forgeVersion')
    const mcpVersion = getArgumentValue(versionManifest.arguments.game, '--fml.mcpVersion')
    if(forgeVersion !== BrandConfig.forgeVersion) {
        throw new Error(`Forge version mismatch: expected ${BrandConfig.forgeVersion}, received ${forgeVersion}`)
    }

    const releaseTag = `${BrandConfig.releaseTagPrefix}${packVersion}`
    const releaseDirectory = path.join(projectRoot, 'release')
    const releaseBaseUrl = `https://github.com/${REPOSITORY}/releases/download/${releaseTag}`
    fs.emptyDirSync(releaseDirectory)

    const forgeCoordinate = `net.minecraftforge:forge:${BrandConfig.minecraftVersion}-${BrandConfig.forgeVersion}`
    const forgeAsset = copyReleaseAsset(
        resolveMavenArtifactPath(minecraftInstall, forgeCoordinate),
        releaseDirectory,
        releaseBaseUrl
    )
    const versionAsset = copyReleaseAsset(versionManifestPath, releaseDirectory, releaseBaseUrl)

    const libraryModules = []
    const seenModuleIds = new Set()
    for(const library of versionManifest.libraries) {
        const artifact = library.downloads?.artifact
        if(!artifact?.path) {
            throw new Error(`Forge runtime library has no artifact path: ${library.name}`)
        }
        addLibraryModule({
            id: library.name,
            sourcePath: path.join(minecraftInstall, 'libraries', ...artifact.path.split('/')),
            releaseDirectory,
            releaseBaseUrl,
            modules: libraryModules,
            seenModuleIds
        })
    }

    const generatedCoordinates = [
        `${forgeCoordinate}:universal`,
        `${forgeCoordinate}:client`,
        `net.minecraft:client:${BrandConfig.minecraftVersion}-${mcpVersion}:srg`,
        `net.minecraft:client:${BrandConfig.minecraftVersion}-${mcpVersion}:extra`
    ]
    for(const coordinate of generatedCoordinates) {
        addLibraryModule({
            id: coordinate,
            sourcePath: resolveMavenArtifactPath(minecraftInstall, coordinate),
            releaseDirectory,
            releaseBaseUrl,
            modules: libraryModules,
            seenModuleIds
        })
    }

    const modAsset = copyReleaseAsset(modPath, releaseDirectory, releaseBaseUrl)
    const distribution = {
        version: packVersion,
        servers: [
            {
                id: BrandConfig.instanceId,
                name: BrandConfig.serverName,
                description: `Minecraft ${BrandConfig.minecraftVersion} / Forge ${BrandConfig.forgeVersion} / ${MOD_NAME}`,
                icon: `https://raw.githubusercontent.com/${REPOSITORY}/blacksmith/app/assets/images/icon.png`,
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
                        id: forgeCoordinate,
                        name: `Minecraft Forge ${BrandConfig.minecraftVersion}-${BrandConfig.forgeVersion}`,
                        type: 'ForgeHosted',
                        artifact: artifactForDistribution(forgeAsset),
                        subModules: [
                            {
                                id: forgeProfile,
                                name: `${forgeProfile} version manifest`,
                                type: 'VersionManifest',
                                artifact: artifactForDistribution(versionAsset)
                            },
                            ...libraryModules
                        ]
                    },
                    {
                        id: MOD_ID,
                        name: MOD_NAME,
                        type: 'ForgeMod',
                        required: {
                            value: true,
                            def: true
                        },
                        artifact: artifactForDistribution(modAsset)
                    }
                ]
            }
        ]
    }

    const distributionText = `${JSON.stringify(distribution, null, 2)}\n`
    fs.writeFileSync(path.join(releaseDirectory, 'distribution.json'), distributionText, 'utf8')
    fs.writeFileSync(path.join(projectRoot, 'distribution.json'), distributionText, 'utf8')

    process.stdout.write(`${JSON.stringify({
        packVersion,
        releaseTag,
        server: BrandConfig.serverName,
        address: BrandConfig.serverAddress,
        minecraftVersion: BrandConfig.minecraftVersion,
        forgeVersion: BrandConfig.forgeVersion,
        forgeProfile,
        mcpVersion,
        forgeLibraries: libraryModules.length,
        mod: path.basename(modPath),
        modSha256: hashFile(modPath, 'sha256'),
        releaseAssets: fs.readdirSync(releaseDirectory).length,
        releaseDirectory
    }, null, 2)}\n`)
}

function validateForgeVersionManifest(manifest, forgeProfile) {
    if(manifest.id !== forgeProfile
        || manifest.inheritsFrom !== BrandConfig.minecraftVersion
        || manifest.mainClass !== 'cpw.mods.bootstraplauncher.BootstrapLauncher'
        || !Array.isArray(manifest.arguments?.game)
        || !Array.isArray(manifest.arguments?.jvm)
        || !Array.isArray(manifest.libraries)
        || manifest.libraries.length === 0) {
        throw new Error(`The selected profile is not the required Forge ${BrandConfig.minecraftVersion} profile.`)
    }
}

function validateArmourersWorkshop(modPath) {
    assertFile(modPath)
    const actualHash = hashFile(modPath, 'sha256')
    if(actualHash !== EXPECTED_MOD_SHA256) {
        throw new Error(`Armourer's Workshop SHA-256 mismatch: ${actualHash}`)
    }

    const archive = new AdmZip(modPath)
    const metadataEntry = archive.getEntry('META-INF/mods.toml')
    if(metadataEntry == null) {
        throw new Error('Armourer\'s Workshop metadata is missing.')
    }
    const metadata = metadataEntry.getData().toString('utf8')
    if(!/modId\s*=\s*"armourers_workshop"/.test(metadata)
        || !/version\s*=\s*"2\.1\.4"/.test(metadata)
        || !/modId\s*=\s*"forge"[\s\S]*?versionRange\s*=\s*"\[46,\)"/.test(metadata)) {
        throw new Error('The selected mod is not Armourer\'s Workshop 2.1.4 for Forge.')
    }
}

function getArgumentValue(argumentsList, name) {
    const index = argumentsList.indexOf(name)
    if(index < 0 || typeof argumentsList[index + 1] !== 'string') {
        throw new Error(`Forge version manifest is missing ${name}`)
    }
    return argumentsList[index + 1]
}

function addLibraryModule({ id, sourcePath, releaseDirectory, releaseBaseUrl, modules, seenModuleIds }) {
    if(seenModuleIds.has(id)) {
        return
    }
    assertFile(sourcePath)
    const asset = copyReleaseAsset(sourcePath, releaseDirectory, releaseBaseUrl)
    modules.push({
        id,
        name: id,
        type: 'Library',
        artifact: artifactForDistribution(asset)
    })
    seenModuleIds.add(id)
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

function resolveMavenArtifactPath(minecraftInstall, coordinate) {
    const parsed = parseMavenIdentifier(coordinate)
    return path.join(
        minecraftInstall,
        'libraries',
        ...parsed.group.split('.'),
        parsed.artifact,
        parsed.version,
        `${parsed.artifact}-${parsed.version}${parsed.classifier ? `-${parsed.classifier}` : ''}.${parsed.extension}`
    )
}

function parseMavenIdentifier(coordinate) {
    const [identifier, declaredExtension] = coordinate.split('@')
    const parts = identifier.split(':')
    if(parts.length < 3 || parts.length > 4 || coordinate.split('@').length > 2) {
        throw new Error(`Unsupported Maven coordinate: ${coordinate}`)
    }
    const [group, artifact, version, classifier = null] = parts
    if(!group || !artifact || !version) {
        throw new Error(`Invalid Maven coordinate: ${coordinate}`)
    }
    return {
        group,
        artifact,
        version,
        classifier,
        extension: declaredExtension || 'jar'
    }
}

function copyReleaseAsset(sourcePath, releaseDirectory, releaseBaseUrl) {
    assertFile(sourcePath)
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
        sha1: hashFile(destination, 'sha1')
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

function hashFile(filePath, algorithm) {
    return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex')
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
    EXPECTED_MOD_SHA256,
    MOD_ID,
    artifactForDistribution,
    getArgumentValue,
    parseArguments,
    parseMavenIdentifier,
    resolveMavenArtifactPath,
    validateArmourersWorkshop,
    validateForgeVersionManifest
}
