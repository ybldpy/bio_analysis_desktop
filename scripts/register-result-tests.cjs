// Test-only loader: use the project's installed TypeScript/Vue compilers without adding dependencies.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function compile(module, filename, source) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  })
  module._compile(result.outputText, filename)
}

require.extensions['.ts'] = (module, filename) =>
  compile(module, filename, fs.readFileSync(filename, 'utf8'))
require.extensions['.vue'] = (module, filename) => {
  const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  if (errors.length) throw errors[0]
  for (const style of descriptor.styles) {
    const result = compileStyle({
      source: style.content,
      filename,
      id: filename,
      scoped: style.scoped
    })
    if (result.errors.length) throw result.errors[0]
  }
  const result = compileScript(descriptor, { id: filename, inlineTemplate: true })
  compile(module, filename, result.content)
}

const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  try {
    return resolve.call(this, request, parent, ...rest)
  } catch (error) {
    if (
      error.code === 'MODULE_NOT_FOUND' &&
      request.startsWith('.') &&
      request.endsWith('.js') &&
      parent
    ) {
      const filename = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts')
      if (fs.existsSync(filename)) return filename
    }
    throw error
  }
}
