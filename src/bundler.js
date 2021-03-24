const { performance } = require('perf_hooks')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const babel = require('@babel/core')

const t1 = performance.now()

let moduleCounter = 0

const createAsset = (filename) => {
    return new Promise(async (resolve, reject) => {
        const content = await promisify(fs.readFile)(filename, 'utf-8')

        const ast = parser.parse(content, {
            sourceType: 'module'
        })

        const dependencies = []

        traverse(ast, {
            ImportDeclaration: ({node}) => {
                dependencies.push(node.source.value)
            }
        })

        const { code } = await promisify(babel.transformFromAst)(ast, null, {
            presets: ['@babel/preset-env']
        })

        resolve({
            id: moduleCounter++,
            filename,
            dependencies,
            code
        })
    })
}

const createGraph = async entry => {
    const mainAsset = await createAsset(path.join(__dirname, entry))

    const queue = [mainAsset]

    for(const asset of queue) {
        asset.mapping = {}

        const dirname = path.dirname(asset.filename)

        for(const relativePath of asset.dependencies) {
            const absolutePath = path.join(dirname, relativePath)

            const childAsset = await createAsset(absolutePath)
            
            asset.mapping[relativePath] = childAsset.id 

            queue.push(childAsset)
        }
    }

    return queue
}

const bundle = graph => {
    let modules = '';

    for(const module of graph) {
        modules += `${module.id}: [
            function(require, module, exports) {
                ${module.code}
            },
            ${JSON.stringify(module.mapping)}
        ],`
    }

    const result = `
        (function(modules) {
            function require(id) {
                const [fn, mapping] = modules[id]

                function localRequire(relativePath) {
                    return require(mapping[relativePath])
                }

                const module = { exports: {} }

                fn(localRequire, module, module.exports)

                return module.exports
            }

            require(0)
        })({${modules}})
    `

    return result
}

const output = async () => {
    return new Promise(async (resolve, reject) => {
        const graph = await createGraph('../example/entry.js')

        resolve(bundle(graph))
    })
}


output().then(res => {
    t2 = performance.now()
    console.log(`time taken: ${(t2-t1)} ms \n`)
    console.log(res)
})