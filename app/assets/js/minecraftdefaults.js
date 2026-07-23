'use strict'

const fs = require('fs-extra')
const path = require('path')
const BrandConfig = require('./brandconfig')

const DEFAULT_OPTIONS = [
    'version:3465',
    'gamma:1.0',
    'guiScale:3',
    'soundCategory_master:0.15',
    'soundCategory_music:0.0',
    `resourcePacks:["vanilla","fabric","file/${BrandConfig.managedResourcePack}"]`,
    'incompatibleResourcePacks:[]',
    ''
].join('\n')

function ensureInitialOptions(gameDirectory) {
    const optionsPath = path.join(gameDirectory, 'options.txt')
    if(fs.existsSync(optionsPath)) {
        return false
    }

    fs.ensureDirSync(gameDirectory)
    fs.writeFileSync(optionsPath, DEFAULT_OPTIONS, 'utf8')
    return true
}

function ensureServerEntry(gameDirectory) {
    const serversPath = path.join(gameDirectory, 'servers.dat')
    fs.ensureDirSync(gameDirectory)

    if(!fs.existsSync(serversPath)) {
        fs.writeFileSync(serversPath, createServersDat([
            createServerCompound(BrandConfig.serverName, BrandConfig.serverAddress)
        ]))
        return true
    }

    const current = fs.readFileSync(serversPath)
    if(current.includes(Buffer.from(BrandConfig.serverAddress, 'utf8'))) {
        return false
    }

    const serversList = findServersList(current)
    const nextLength = Buffer.alloc(4)
    nextLength.writeInt32BE(serversList.length + 1)
    const updated = Buffer.concat([
        current.subarray(0, serversList.lengthOffset),
        nextLength,
        current.subarray(serversList.lengthOffset + 4, serversList.endOffset),
        createServerCompound(BrandConfig.serverName, BrandConfig.serverAddress),
        current.subarray(serversList.endOffset)
    ])
    fs.writeFileSync(serversPath, updated)
    return true
}

function createServersDat(compounds) {
    const length = Buffer.alloc(4)
    length.writeInt32BE(compounds.length)
    return Buffer.concat([
        Buffer.from([0x0A, 0x00, 0x00, 0x09]),
        createNbtName('servers'),
        Buffer.from([0x0A]),
        length,
        ...compounds,
        Buffer.from([0x00])
    ])
}

function createNbtName(value) {
    const valueBuffer = Buffer.from(value, 'utf8')
    const lengthBuffer = Buffer.alloc(2)
    lengthBuffer.writeUInt16BE(valueBuffer.length)
    return Buffer.concat([lengthBuffer, valueBuffer])
}

function createNbtStringTag(name, value) {
    return Buffer.concat([
        Buffer.from([0x08]),
        createNbtName(name),
        createNbtName(value)
    ])
}

function createNbtByteTag(name, value) {
    return Buffer.concat([
        Buffer.from([0x01]),
        createNbtName(name),
        Buffer.from([value])
    ])
}

function createServerCompound(name, address) {
    return Buffer.concat([
        createNbtStringTag('name', name),
        createNbtStringTag('ip', address),
        createNbtByteTag('acceptTextures', 1),
        Buffer.from([0x00])
    ])
}

function findServersList(buffer) {
    const state = { offset: 0 }
    const rootType = readTagType(buffer, state)
    if(rootType !== 10) {
        throw new Error('servers.dat root tag is not a compound')
    }
    readName(buffer, state)

    while(true) {
        const tagType = readTagType(buffer, state)
        if(tagType === 0) {
            throw new Error('servers list not found')
        }

        const tagName = readName(buffer, state)
        if(tagType === 9 && tagName === 'servers') {
            assertReadable(buffer, state, 5)
            const elementType = buffer.readUInt8(state.offset++)
            const lengthOffset = state.offset
            const listLength = buffer.readInt32BE(state.offset)
            state.offset += 4
            if(elementType !== 10 || listLength < 0) {
                throw new Error('servers list is invalid')
            }
            for(let i = 0; i < listLength; i++) {
                skipPayload(buffer, state, elementType)
            }
            return { length: listLength, lengthOffset, endOffset: state.offset }
        }
        skipPayload(buffer, state, tagType)
    }
}

function readTagType(buffer, state) {
    assertReadable(buffer, state, 1)
    return buffer.readUInt8(state.offset++)
}

function readName(buffer, state) {
    assertReadable(buffer, state, 2)
    const length = buffer.readUInt16BE(state.offset)
    state.offset += 2
    assertReadable(buffer, state, length)
    const start = state.offset
    state.offset += length
    return buffer.toString('utf8', start, state.offset)
}

function skipPayload(buffer, state, tagType) {
    switch(tagType) {
        case 1: return skipBytes(buffer, state, 1)
        case 2: return skipBytes(buffer, state, 2)
        case 3:
        case 5: return skipBytes(buffer, state, 4)
        case 4:
        case 6: return skipBytes(buffer, state, 8)
        case 7: return skipArray(buffer, state, 1)
        case 8: return skipString(buffer, state)
        case 9: return skipList(buffer, state)
        case 10: return skipCompound(buffer, state)
        case 11: return skipArray(buffer, state, 4)
        case 12: return skipArray(buffer, state, 8)
        default: throw new Error(`Unsupported NBT tag type ${tagType}`)
    }
}

function skipBytes(buffer, state, length) {
    assertReadable(buffer, state, length)
    state.offset += length
}

function skipString(buffer, state) {
    assertReadable(buffer, state, 2)
    const length = buffer.readUInt16BE(state.offset)
    state.offset += 2
    skipBytes(buffer, state, length)
}

function skipArray(buffer, state, elementSize) {
    assertReadable(buffer, state, 4)
    const length = buffer.readInt32BE(state.offset)
    state.offset += 4
    if(length < 0) {
        throw new Error('NBT array length is invalid')
    }
    skipBytes(buffer, state, length * elementSize)
}

function skipList(buffer, state) {
    assertReadable(buffer, state, 5)
    const elementType = buffer.readUInt8(state.offset++)
    const length = buffer.readInt32BE(state.offset)
    state.offset += 4
    if(length < 0) {
        throw new Error('NBT list length is invalid')
    }
    for(let i = 0; i < length; i++) {
        skipPayload(buffer, state, elementType)
    }
}

function skipCompound(buffer, state) {
    while(true) {
        const tagType = readTagType(buffer, state)
        if(tagType === 0) {
            return
        }
        readName(buffer, state)
        skipPayload(buffer, state, tagType)
    }
}

function assertReadable(buffer, state, length) {
    if(length < 0 || state.offset + length > buffer.length) {
        throw new Error('Unexpected end of NBT data')
    }
}

module.exports = {
    DEFAULT_OPTIONS,
    createServersDat,
    createServerCompound,
    ensureInitialOptions,
    ensureServerEntry,
    findServersList
}
