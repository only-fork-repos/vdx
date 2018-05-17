const promisify = require('util').promisify
const consola = require('consola')
const execa = require('execa')
const path = require('path')
const mkdirp = promisify(require('mkdirp'))
const rimraf = promisify(require('rimraf'))
const uniqueSlug = require('unique-slug')

const stdinSentinel = '-'
const defaultFileExtension = 'mp4'

function createFFmpegCommand (ffmpegBinaryPath, inputFile, outputFile, options) {
  const stringifiedOptions = stringifyFFmpegOptions(options)
  return `${ffmpegBinaryPath} -y -i "${inputFile}" ${stringifiedOptions} -- "${outputFile}"`
}

function stringifyFFmpegOptions (options) {
  return Object.keys(options)
    .reduce(function (result, key) {
      const value = options[key]
      if (value) {
        result.push(`-${key}`)
        if (typeof value !== 'boolean') {
          result.push(value)
        }
      }
      return result
    }, [])
    .join(' ')
}

function setFileExtension (file, newExtension) {
  const parentDirectory = path.dirname(file)
  const extension = path.extname(file)
  const basename = path.basename(file, extension)
  return path.join(parentDirectory, `${basename}.${newExtension}`)
}

function getTemporaryFilePath (inputFile, outputDirectory) {
  const temporaryFile =
    inputFile === stdinSentinel
      ? `${uniqueSlug()}.${defaultFileExtension}`
      : path.basename(inputFile)
  return path.join(outputDirectory, `temp-${temporaryFile}`)
}

function getOutputFilePath (inputFile, outputDirectory, outputFormat) {
  let outputFile = inputFile
  if (outputFile === stdinSentinel) {
    outputFile = `${uniqueSlug()}.${defaultFileExtension}`
  }
  if (typeof outputFormat !== 'undefined') {
    outputFile = setFileExtension(outputFile, outputFormat)
  }
  return path.join(outputDirectory, outputFile)
}

function createCommand (
  inputFile,
  outputDirectory,
  format,
  ffmpegBinaryPath,
  ffmpegOptions
) {
  const temporaryFile = getTemporaryFilePath(inputFile, outputDirectory)
  const outputFile = getOutputFilePath(inputFile, outputDirectory, format)
  const parentDirectory = path.resolve(outputFile, '..')

  const hasFilters = ffmpegOptions.audioFilters || ffmpegOptions.videoFilters
  const isStdin = inputFile === stdinSentinel

  return async function () {
    consola.start(isStdin ? 'stdin' : inputFile)
    await mkdirp(parentDirectory)
    try {
      await new Promise(async function (resolve) {
        const flagCommand = createFFmpegCommand(ffmpegBinaryPath, inputFile, hasFilters ? temporaryFile : outputFile, ffmpegOptions.flags)
        const childProcess = execa.shell(flagCommand)
        if (isStdin) {
          childProcess.on('exit', function () {
            resolve()
          })
          process.stdin.pipe(childProcess.stdin)
          return
        }
        await childProcess
        resolve()
      })
      if (hasFilters) {
        const filtersCommand = createFFmpegCommand(ffmpegBinaryPath, temporaryFile, outputFile, {
          af: ffmpegOptions.audioFilters,
          vf: ffmpegOptions.videoFilters
        })
        await execa.shell(filtersCommand)
      }
      consola.success(outputFile)
    } catch (error) {
      consola.error(outputFile)
    } finally {
      await rimraf(temporaryFile)
    }
  }
}

module.exports = createCommand
