'use strict'

const AdmZip = require('adm-zip')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const test = require('node:test')
const BundleManager = require('../app/assets/js/bundlemanager')

function descriptor(pathValue, data) {
    return {
        path: pathValue,
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex')
    }
}

test('managed bundle replaces owned files while preserving user additions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripige-bundle-'))
    try {
        const dataDirectory = path.join(root, 'data')
        const cacheDirectory = path.join(root, 'cache')
        const archivePath = path.join(root, 'bundle.zip')
        const userMod = path.join(dataDirectory, 'instances', 'ripige', 'mods', 'custom-user-mod.jar')
        const otherPack = path.join(dataDirectory, 'instances', 'ripige', 'resourcepacks', 'OtherPack', 'pack.mcmeta')
        const userShader = path.join(dataDirectory, 'instances', 'ripige', 'shaderpacks', 'UserShader.zip')
        const obsoleteManagedShader = path.join(dataDirectory, 'instances', 'ripige', 'shaderpacks', 'OldManagedShader.zip')
        const obsoleteManagedMod = path.join(dataDirectory, 'common', 'mods', 'fabric', 'old-managed.jar')
        fs.outputFileSync(userMod, 'user')
        fs.outputFileSync(otherPack, '{}')
        fs.outputFileSync(userShader, 'user-shader')
        fs.outputFileSync(obsoleteManagedShader, 'old-shader')
        fs.outputFileSync(obsoleteManagedMod, 'old')

        const files = new Map([
            ['common/mods/fabric/fabric-api.jar', Buffer.from('fabric-api')],
            ['instances/ripige/resourcepacks/ROW-1.20.1-Unpacked-Original/pack.mcmeta', Buffer.from('{"pack":{}}')],
            ['instances/ripige/resourcepacks/ROW-1.20.1-Unpacked-Original/assets/example.txt', Buffer.from('resource')],
            ['instances/ripige/shaderpacks/ComplementaryReimagined_r5.8.1.zip', Buffer.from('managed-shader')]
        ])
        const zip = new AdmZip()
        for(const [entryPath, data] of files) {
            zip.addFile(entryPath, data)
        }
        zip.writeZip(archivePath)

        const manifest = {
            schemaVersion: 1,
            packVersion: '1.0.0',
            minecraftVersion: '1.20.1',
            fabricLoaderVersion: '0.19.3',
            bundle: {
                url: 'https://example.invalid/bundle.zip',
                size: fs.statSync(archivePath).size,
                sha256: await BundleManager.sha256File(archivePath)
            },
            files: [...files].map(([entryPath, data]) => descriptor(entryPath, data))
        }
        const previousManifest = {
            ...manifest,
            packVersion: '0.9.0',
            files: [
                descriptor('common/mods/fabric/old-managed.jar', Buffer.from('old')),
                descriptor('instances/ripige/shaderpacks/OldManagedShader.zip', Buffer.from('old-shader'))
            ]
        }

        BundleManager.applyBundleArchive({
            archivePath,
            dataDirectory,
            cacheDirectory,
            manifest,
            previousManifest
        })

        assert.equal(fs.readFileSync(userMod, 'utf8'), 'user')
        assert.equal(fs.readFileSync(otherPack, 'utf8'), '{}')
        assert.equal(fs.readFileSync(userShader, 'utf8'), 'user-shader')
        assert.equal(fs.existsSync(obsoleteManagedMod), false)
        assert.equal(fs.existsSync(obsoleteManagedShader), false)
        assert.equal(fs.readFileSync(path.join(dataDirectory, 'common', 'mods', 'fabric', 'fabric-api.jar'), 'utf8'), 'fabric-api')
        assert.equal(
            fs.readFileSync(path.join(dataDirectory, 'instances', 'ripige', 'shaderpacks', 'ComplementaryReimagined_r5.8.1.zip'), 'utf8'),
            'managed-shader'
        )
        assert.equal(await BundleManager.validateInstallation(dataDirectory, manifest), true)
    } finally {
        fs.removeSync(root)
    }
})

test('bundle paths cannot escape managed roots', () => {
    assert.equal(BundleManager.isAllowedManagedPath('../outside.txt'), false)
    assert.equal(BundleManager.isAllowedManagedPath('instances/ripige/mods/not-managed.jar'), false)
    assert.equal(BundleManager.isAllowedManagedPath('instances/ripige/shaderpacks/ManagedShader.zip'), true)
    assert.throws(() => BundleManager.normalizeArchivePath('C:\\outside.txt'))
})
