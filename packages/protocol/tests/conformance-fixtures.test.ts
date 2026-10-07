import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  acceptNegotiatedCapabilities,
  browserAuthorizationExchangeRequestSchema,
  browserAuthorizationExchangeResponseSchema,
  deviceRefreshRequestSchema,
  deviceRegistrationRequestSchema,
  deviceTokenPairSchema,
  decodeControlFrame,
  encodeControlFrame,
  hostRegistrationCodeRequestSchema,
  parseControlFrame,
  rpcErrorPayloadSchema,
  selectCapabilities,
  selectProtocolVersion,
} from '../src/index.js'
import { loadProtocolFixtures, type ProtocolFixtureCase } from './conformance-fixture-loader.js'

const suites = await loadProtocolFixtures()

for (const suite of suites) {
  describe(`${suite.name} conformance fixtures`, () => {
    const contracts = new Map<string, ProtocolFixtureCase[]>()
    for (const testCase of suite.cases) {
      const input = fixtureInput(testCase)
      const contract = testCase.operation === 'parseControlFrame'
        ? `${testCase.operation}:${input.type ?? 'envelope'}`
        : testCase.operation
      const cases = contracts.get(contract) ?? []
      cases.push(testCase)
      contracts.set(contract, cases)
    }
    for (const [contract, cases] of contracts) {
      it(contract, async () => {
        await runScenarios(
          cases.map((testCase) => ({
            name: testCase.name,
            run: () => {
              const execute = () => executeFixture(testCase)
              if (!testCase.expect.accepted) {
                expect(execute).toThrow()
                return
              }
              const result = execute()
              if ('selected' in testCase.expect) expect(result ?? null).toEqual(testCase.expect.selected)
              if ('value' in testCase.expect) expect(result).toEqual(testCase.expect.value)
            },
          })),
        )
      })
    }
  })
}

function executeFixture(testCase: ProtocolFixtureCase): unknown {
  const input = fixtureInput(testCase)
  if (testCase.operation === 'parseControlFrame') return parseControlFrame(testCase.input)
  if (testCase.operation === 'parseDeviceRegistrationRequest') return deviceRegistrationRequestSchema.parse(testCase.input)
  if (testCase.operation === 'parseHostRegistrationCodeRequest') return hostRegistrationCodeRequestSchema.parse(testCase.input)
  if (testCase.operation === 'parseDeviceRefreshRequest') return deviceRefreshRequestSchema.parse(testCase.input)
  if (testCase.operation === 'parseDeviceTokenPair') return deviceTokenPairSchema.parse(testCase.input)
  if (testCase.operation === 'parseBrowserAuthorizationExchangeRequest') {
    return browserAuthorizationExchangeRequestSchema.parse(testCase.input)
  }
  if (testCase.operation === 'parseBrowserAuthorizationExchangeResponse') {
    return browserAuthorizationExchangeResponseSchema.parse(testCase.input)
  }
  if (testCase.operation === 'parseRpcErrorPayload') return rpcErrorPayloadSchema.parse(testCase.input)
  if (testCase.operation === 'encodeControlFrameWithLimits') {
    const input = fixtureInput(testCase)
    return encodeControlFrame(parseControlFrame(input.frame), controlFrameLimits(input))
  }
  if (testCase.operation === 'decodeControlFrameWithLimits') {
    const input = fixtureInput(testCase)
    return decodeControlFrame(requiredString(input.data, 'data'), controlFrameLimits(input))
  }
  if (testCase.operation === 'selectProtocolVersion') {
    return selectProtocolVersion(numberList(input.offered, 'offered'), numberList(input.supported, 'supported'))
  }
  if (testCase.operation === 'selectCapabilities') {
    return selectCapabilities(stringList(input.offered, 'offered'), stringList(input.supported, 'supported'))
  }
  const negotiated = 'negotiated' in input ? stringList(input.negotiated, 'negotiated') : undefined
  return acceptNegotiatedCapabilities(stringList(input.offered, 'offered'), negotiated)
}

function controlFrameLimits(input: Record<string, unknown>) {
  const rawLimits = record(input.limits, 'limits')
  const maxControlFrameBytes = optionalNumber(rawLimits.maxControlFrameBytes, 'maxControlFrameBytes')
  const maxRelayFrameBytes = optionalNumber(rawLimits.maxRelayFrameBytes, 'maxRelayFrameBytes')
  return { maxControlFrameBytes, maxRelayFrameBytes }
}

function fixtureInput(testCase: ProtocolFixtureCase): Record<string, unknown> {
  if (typeof testCase.input !== 'object' || testCase.input === null || Array.isArray(testCase.input)) {
    throw new Error(`Fixture input must be an object: ${testCase.name}`)
  }
  return testCase.input as Record<string, unknown>
}

function numberList(value: unknown, name: string): number[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'number')) {
    throw new Error(`Fixture ${name} must be a number array.`)
  }
  return value
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`Fixture ${name} must be a string array.`)
  }
  return value
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Fixture ${name} must be an object.`)
  }
  return value as Record<string, unknown>
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || typeof value === 'number') return value
  throw new Error(`Fixture ${name} must be a number.`)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === 'string') return value
  throw new Error(`Fixture ${name} must be a string.`)
}
