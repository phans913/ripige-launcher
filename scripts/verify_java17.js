'use strict'

const fs = require('fs-extra')
const path = require('path')
const { spawnSync } = require('child_process')
const { validateLocalFile } = require('helios-core/common')
const { downloadFile } = require('helios-core/dl')
const { latestOpenJDK, extractJdk } = require('helios-core/java')

async function main() {
    const dataDir = parseDataDirectory(process.argv.slice(2))
    await fs.ensureDir(dataDir)

    const asset = await latestOpenJDK(17, dataDir)
    if(asset == null) {
        throw new Error('Java 17 Temurin asset could not be resolved.')
    }

    let lastPercent = -1
    await downloadFile(asset.url, asset.path, progress => {
        const percent = Math.floor((progress.transferred / asset.size) * 100)
        if(percent >= lastPercent + 10) {
            lastPercent = percent
            process.stdout.write(`Java 17 download: ${percent}%\n`)
        }
    })

    if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
        throw new Error('Downloaded Java 17 archive failed SHA-256 validation.')
    }

    const javawPath = await extractJdk(asset.path)
    const javaPath = process.platform === 'win32'
        ? path.join(path.dirname(javawPath), 'java.exe')
        : javawPath
    const versionResult = spawnSync(javaPath, ['-version'], { encoding: 'utf8' })
    const versionOutput = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`.trim()

    if(versionResult.status !== 0 || !/version "17\./.test(versionOutput)) {
        throw new Error(`Prepared runtime is not Java 17: ${versionOutput || '<no output>'}`)
    }

    process.stdout.write(`${JSON.stringify({
        archive: asset.id,
        size: asset.size,
        sha256: asset.hash,
        executable: javaPath,
        version: versionOutput.split(/\r?\n/)[0]
    }, null, 2)}\n`)
}

function parseDataDirectory(argv) {
    const args = argv.filter(argument => argument !== '--')
    const dataDirIndex = args.indexOf('--data-dir')
    if(dataDirIndex === -1 || !args[dataDirIndex + 1]) {
        throw new Error('Usage: node scripts/verify_java17.js --data-dir <temporary-directory>')
    }
    return path.resolve(args[dataDirIndex + 1])
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
})
