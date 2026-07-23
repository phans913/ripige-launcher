'use strict'

const AdmZip = require('adm-zip')
const crypto = require('crypto')
const fs = require('fs-extra')
const got = require('got')
const path = require('path')
const BrandConfig = require('./brandconfig')

const DEFAULT_MANIFEST_URL = 'https://github.com/phans913/ripige-launcher/releases/latest/download/bundle-manifest.json'
const MANAGED_MOD_PREFIX = 'common/mods/fabric/'
const MANAGED_PACK_PREFIX = `instances/${BrandConfig.instanceId}/resourcepacks/${BrandConfig.managedResourcePack}/`

function getConfiguredManifestUrl() {
    const candidates = [
        path.join(__dirname, '..', 'defaults', 'bundle_manifest_url.txt'),
        path.join(__dirname, '..', '..', '..', 'app', 'assets', 'defaults', 'bundle_manifest_url.txt')
    ]
    const configured = candidates.find(candidate => fs.existsSync(candidate))
    if(configured != null) {
        const value = fs.readFileSync(configured, 'utf8').trim()
        if(value && !value.startsWith('#')) {
            return value
        }
    }
    return DEFAULT_MANIFEST_URL
}

function validateManifest(manifest) {
    if(manifest == null || manifest.schemaVersion !== 1) {
        throw new Error('지원하지 않는 리피지 번들 매니페스트입니다.')
    }
    if(!manifest.packVersion || !manifest.bundle?.url || !Number.isSafeInteger(manifest.bundle.size) || !isSha256(manifest.bundle.sha256)) {
        throw new Error('리피지 번들 정보가 올바르지 않습니다.')
    }
    if(manifest.minecraftVersion !== BrandConfig.minecraftVersion || manifest.fabricLoaderVersion !== BrandConfig.fabricLoaderVersion) {
        throw new Error('런처와 게임 파일 버전이 맞지 않습니다.')
    }
    if(!Array.isArray(manifest.files) || manifest.files.length === 0) {
        throw new Error('리피지 번들 파일 목록이 비어 있습니다.')
    }

    const seen = new Set()
    for(const file of manifest.files) {
        if(!isAllowedManagedPath(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.size) || !isSha256(file.sha256)) {
            throw new Error(`관리 파일 정보가 올바르지 않습니다: ${file.path}`)
        }
        seen.add(file.path)
    }
    return manifest
}

async function ensureRuntimeManagedBundle({ force = false, logger = console } = {}) {
    const ConfigManager = require('./configmanager')
    return ensureManagedBundle({
        dataDirectory: ConfigManager.getDataDirectory(),
        launcherDirectory: ConfigManager.getLauncherDirectory(),
        manifestUrl: getConfiguredManifestUrl(),
        force,
        logger
    })
}

async function ensureManagedBundle({ dataDirectory, launcherDirectory, manifestUrl, force = false, logger = console }) {
    const cacheDirectory = path.join(launcherDirectory, 'cache')
    const cachedManifestPath = path.join(cacheDirectory, 'bundle-manifest.json')
    const markerPath = path.join(cacheDirectory, 'installed-bundle.json')
    fs.ensureDirSync(cacheDirectory)

    const marker = readJsonIfPresent(markerPath)
    let manifest = null
    let remoteAvailable = false

    try {
        manifest = validateManifest(await got(manifestUrl, {
            responseType: 'json',
            retry: { limit: 1 },
            timeout: { request: 15000 }
        }).json())
        fs.writeJsonSync(cachedManifestPath, manifest, { spaces: 2 })
        remoteAvailable = true
    } catch(error) {
        logger.warn?.('Remote bundle manifest unavailable, trying local cache.', error.message)
        const cached = readJsonIfPresent(cachedManifestPath) || marker?.manifest
        if(cached != null) {
            manifest = validateManifest(cached)
        }
    }

    if(manifest == null) {
        throw new Error('리피지 게임 파일 정보를 내려받을 수 없습니다. 인터넷 연결을 확인해 주세요.')
    }

    const installationValid = await validateInstallation(dataDirectory, manifest)
    if(!force && installationValid && marker?.manifest?.packVersion === manifest.packVersion) {
        return { changed: false, offline: !remoteAvailable, manifest }
    }

    const bundlePath = path.join(cacheDirectory, `ripige-modpack-bundle-${manifest.packVersion}.zip`)
    if(!(await validateArtifact(bundlePath, manifest.bundle))) {
        if(!remoteAvailable && !manifest.bundle.url) {
            throw new Error('설치된 리피지 게임 파일이 손상되었고 복구 번들을 사용할 수 없습니다.')
        }
        const temporaryPath = `${bundlePath}.part`
        fs.removeSync(temporaryPath)
        logger.info?.('Downloading managed 리피지 game bundle.')
        let bundleBuffer
        try {
            bundleBuffer = await got(manifest.bundle.url, {
                responseType: 'buffer',
                retry: { limit: 1 },
                timeout: { request: 120000 }
            }).buffer()
        } catch(error) {
            if(installationValid) {
                logger.warn?.('Bundle download failed; using valid installed files.', error.message)
                return { changed: false, offline: true, manifest }
            }
            throw new Error(`리피지 게임 파일 다운로드에 실패했습니다: ${error.message}`)
        }
        fs.writeFileSync(temporaryPath, bundleBuffer)
        if(!(await validateArtifact(temporaryPath, manifest.bundle))) {
            fs.removeSync(temporaryPath)
            throw new Error('다운로드한 리피지 번들의 크기 또는 SHA-256이 일치하지 않습니다.')
        }
        fs.moveSync(temporaryPath, bundlePath, { overwrite: true })
    }

    applyBundleArchive({
        archivePath: bundlePath,
        dataDirectory,
        cacheDirectory,
        manifest,
        previousManifest: marker?.manifest
    })

    fs.writeJsonSync(markerPath, {
        installedAt: new Date().toISOString(),
        manifest
    }, { spaces: 2 })
    return { changed: true, offline: !remoteAvailable, manifest }
}

function applyBundleArchive({ archivePath, dataDirectory, cacheDirectory, manifest, previousManifest = null }) {
    validateManifest(manifest)
    const archive = new AdmZip(archivePath)
    const expected = new Set(manifest.files.map(file => file.path))
    const stageDirectory = path.join(cacheDirectory, `bundle-stage-${process.pid}`)
    fs.emptyDirSync(stageDirectory)

    try {
        for(const entry of archive.getEntries()) {
            const entryName = normalizeArchivePath(entry.entryName)
            if(!entryName) {
                continue
            }
            if(entry.isDirectory) {
                if(!isAllowedManagedDirectory(entryName)) {
                    throw new Error(`허용되지 않은 번들 경로입니다: ${entryName}`)
                }
                continue
            }
            if(!expected.has(entryName) || !isAllowedManagedPath(entryName)) {
                throw new Error(`매니페스트에 없는 번들 파일입니다: ${entryName}`)
            }
            const target = resolveManagedPath(stageDirectory, entryName)
            fs.ensureDirSync(path.dirname(target))
            fs.writeFileSync(target, entry.getData())
        }

        for(const file of manifest.files) {
            const stagedPath = resolveManagedPath(stageDirectory, file.path)
            if(!fs.existsSync(stagedPath) || fs.statSync(stagedPath).size !== file.size || sha256FileSync(stagedPath) !== file.sha256.toLowerCase()) {
                throw new Error(`압축 해제된 파일 검증에 실패했습니다: ${file.path}`)
            }
        }

        installManagedMods(stageDirectory, dataDirectory, manifest, previousManifest)
        installManagedResourcePack(stageDirectory, dataDirectory)
    } finally {
        fs.removeSync(stageDirectory)
    }
}

function installManagedMods(stageDirectory, dataDirectory, manifest, previousManifest) {
    const nextMods = manifest.files.filter(file => file.path.startsWith(MANAGED_MOD_PREFIX))
    const nextPaths = new Set(nextMods.map(file => file.path))
    for(const file of nextMods) {
        const source = resolveManagedPath(stageDirectory, file.path)
        const target = resolveManagedPath(dataDirectory, file.path)
        const incoming = `${target}.incoming`
        fs.ensureDirSync(path.dirname(target))
        fs.copyFileSync(source, incoming)
        fs.moveSync(incoming, target, { overwrite: true })
    }

    for(const file of previousManifest?.files || []) {
        if(file.path.startsWith(MANAGED_MOD_PREFIX) && !nextPaths.has(file.path)) {
            fs.removeSync(resolveManagedPath(dataDirectory, file.path))
        }
    }
}

function installManagedResourcePack(stageDirectory, dataDirectory) {
    const relativePackDirectory = `instances/${BrandConfig.instanceId}/resourcepacks/${BrandConfig.managedResourcePack}`
    const stagedPack = resolveManagedPath(stageDirectory, relativePackDirectory)
    const targetPack = resolveManagedPath(dataDirectory, relativePackDirectory)
    const incomingPack = `${targetPack}.incoming`
    const backupPack = `${targetPack}.backup`
    fs.removeSync(incomingPack)
    fs.removeSync(backupPack)
    fs.ensureDirSync(path.dirname(targetPack))
    fs.copySync(stagedPack, incomingPack)

    let movedOriginal = false
    try {
        if(fs.existsSync(targetPack)) {
            fs.moveSync(targetPack, backupPack)
            movedOriginal = true
        }
        fs.moveSync(incomingPack, targetPack)
        fs.removeSync(backupPack)
    } catch(error) {
        fs.removeSync(incomingPack)
        if(movedOriginal && !fs.existsSync(targetPack) && fs.existsSync(backupPack)) {
            fs.moveSync(backupPack, targetPack)
        }
        throw error
    }
}

async function validateInstallation(dataDirectory, manifest) {
    validateManifest(manifest)
    for(const file of manifest.files) {
        const filePath = resolveManagedPath(dataDirectory, file.path)
        if(!fs.existsSync(filePath)) {
            return false
        }
        const stats = fs.statSync(filePath)
        if(!stats.isFile() || stats.size !== file.size || await sha256File(filePath) !== file.sha256.toLowerCase()) {
            return false
        }
    }
    return true
}

async function validateArtifact(filePath, artifact) {
    if(!fs.existsSync(filePath) || fs.statSync(filePath).size !== artifact.size) {
        return false
    }
    return await sha256File(filePath) === artifact.sha256.toLowerCase()
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        stream.on('error', reject)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

function sha256FileSync(filePath) {
    const hash = crypto.createHash('sha256')
    hash.update(fs.readFileSync(filePath))
    return hash.digest('hex')
}

function readJsonIfPresent(filePath) {
    if(!fs.existsSync(filePath)) {
        return null
    }
    try {
        return fs.readJsonSync(filePath)
    } catch(_error) {
        return null
    }
}

function normalizeArchivePath(value) {
    const normalized = String(value).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
    if(!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
        if(!normalized) {
            return ''
        }
        throw new Error(`안전하지 않은 번들 경로입니다: ${value}`)
    }
    return normalized
}

function isAllowedManagedPath(value) {
    if(typeof value !== 'string' || value.endsWith('/') || value.includes('\\')) {
        return false
    }
    let normalized
    try {
        normalized = normalizeArchivePath(value)
    } catch(_error) {
        return false
    }
    return normalized.startsWith(MANAGED_MOD_PREFIX) || normalized.startsWith(MANAGED_PACK_PREFIX)
}

function isAllowedManagedDirectory(value) {
    const normalized = normalizeArchivePath(value)
    return [MANAGED_MOD_PREFIX, MANAGED_PACK_PREFIX].some(prefix =>
        prefix.startsWith(`${normalized}/`) || `${normalized}/`.startsWith(prefix)
    )
}

function resolveManagedPath(root, relativePath) {
    const normalized = normalizeArchivePath(relativePath)
    const resolvedRoot = path.resolve(root)
    const resolved = path.resolve(resolvedRoot, ...normalized.split('/'))
    if(resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`관리 경로가 루트를 벗어났습니다: ${relativePath}`)
    }
    return resolved
}

function isSha256(value) {
    return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value)
}

module.exports = {
    DEFAULT_MANIFEST_URL,
    applyBundleArchive,
    ensureManagedBundle,
    ensureRuntimeManagedBundle,
    getConfiguredManifestUrl,
    isAllowedManagedPath,
    normalizeArchivePath,
    resolveManagedPath,
    sha256File,
    validateInstallation,
    validateManifest
}
